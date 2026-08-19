/**
 * pos.ventas.service.js — Venta de mostrador.
 * Transacción central: valida turno abierto, receta para controlados, pagos;
 * inserta venta + partidas (snapshots) y descuenta inventario vía
 * registrarSalidaFEFO (restringido al almacén de la sucursal).
 * Reglas:
 *  - Idempotencia por client_uuid: un reintento devuelve la venta ya creada.
 *  - Controlado (clasificación ≠ libre/venta_farmacia) sin receta → 422; el
 *    backend es la fuente de verdad, no la UI.
 *  - Stock insuficiente → 409 con lo disponible; el mostrador nunca vende
 *    en negativo ni ajusta nada solo.
 */
const { pool } = require('../../config/db');
const inv = require('../inventario/movimientos.service');
const { getScoped } = require('./pos.tenant.helpers');
const promociones = require('./pos.promociones.service');

const CLASIF_LIBRES = ['libre', 'venta_farmacia'];

// Existencia: siempre en piezas (inventario_lotes), compartida por TODAS las
// presentaciones de un mismo producto (ver migrate_v39) — vender 1 pieza
// suelta resta del mismo contador que necesita "1 vitrolero completo".
const EXISTENCIA_SUB = `COALESCE((SELECT SUM(l.cantidad_actual) FROM inventario_lotes l
                     WHERE l.producto_id = p.id AND l.almacen_id = ?), 0)`;

// Columnas devueltas por un producto SIN presentación (fila "tal cual") y por
// una fila POR PRESENTACIÓN (ej. "Vitrolero") — mismas 9 columnas en ambos
// casos para que ambas ramas se puedan UNION ALL / mapear igual en JS.
// Compartidas por sqlBusqueda() (búsqueda del mostrador) y favoritos() para
// no mantener dos copias del mismo SELECT.
const CAMPOS_PRODUCTO_BASE = `p.id AS producto_id, NULL AS presentacion_id, p.descripcion,
           p.sku_interno, p.ean, p.precio_lista, 1.00 AS factor_conversion,
           p.clasificacion_cofepris, p.control_lote_caducidad,
           ${EXISTENCIA_SUB} AS existencia`;
const CAMPOS_PRESENTACION = `p.id AS producto_id, pp.id AS presentacion_id,
           CONCAT(p.descripcion, ' - ', pp.nombre) AS descripcion,
           p.sku_interno, pp.ean, COALESCE(pp.precio_lista, p.precio_lista * pp.factor_conversion) AS precio_lista,
           pp.factor_conversion,
           p.clasificacion_cofepris, p.control_lote_caducidad,
           ${EXISTENCIA_SUB} AS existencia`;

// Un producto SIN presentaciones activas se busca/vende tal cual (comportamiento
// idéntico al de antes de migrate_v39). Un producto CON presentaciones activas
// (ej. "Pieza suelta" + "Vitrolero") reemplaza esa fila única por una fila POR
// PRESENTACIÓN, cada una con su propio precio/EAN pero la MISMA existencia.
function sqlBusqueda(filtroBase, filtroPresentacion) {
  return `
    SELECT ${CAMPOS_PRODUCTO_BASE}
    FROM productos p
    WHERE p.activo = 1 AND p.vendible = 1
      AND NOT EXISTS (SELECT 1 FROM producto_presentaciones x WHERE x.producto_id = p.id AND x.activo_pos = 1)
      AND (${filtroBase})
    UNION ALL
    SELECT ${CAMPOS_PRESENTACION}
    FROM productos p JOIN producto_presentaciones pp ON pp.producto_id = p.id AND pp.activo_pos = 1
    WHERE p.activo = 1 AND p.vendible = 1
      AND (${filtroPresentacion})`;
}

// Decora filas de búsqueda/favoritos con la promoción vigente (si hay) sobre
// el `precio_lista` de CADA fila (correcto también para presentaciones, que
// ya traen su propio precio resuelto) — mismo resolver que usa crearVenta,
// así el carrito y el cobro siempre coinciden (ver pos.promociones.service.js).
// `clienteFlags` refleja al cliente de fidelidad ya elegido en el carrito
// (migrate_v47) — sin cliente, solo aplican promociones sin requiere_cliente.
async function decorarPromos(conn, empresaId, rows, clienteFlags) {
  if (!rows.length) return rows;
  const promos = await promociones.descuentosPara(conn, empresaId, rows.map((r) => r.producto_id), undefined, clienteFlags);
  return rows.map((r) => {
    const promo = promos.get(r.producto_id);
    if (!promo) return { ...r, descuento_pct: null, promocion_nombre: null, precio_final: Number(r.precio_lista) };
    const precioFinal = Math.round(Number(r.precio_lista) * (1 - promo.pct / 100) * 100) / 100;
    return { ...r, descuento_pct: promo.pct, promocion_nombre: promo.nombre, precio_final: precioFinal };
  });
}

// Cliente de fidelidad ya elegido en el carrito (migrate_v47, opcional): sin
// él, {adultoMayor:false, lealtad:false} (default de descuentosPara) — solo
// aplican promociones sin requiere_cliente. Un cliente inactivo (baja lógica)
// se trata como si no hubiera cliente, no sigue otorgando el descuento.
async function resolverClienteFidelidad(conn, empresaId, clienteFidelidadId) {
  if (!clienteFidelidadId) return undefined;
  const cliente = await getScoped(conn, 'pos_clientes_fidelidad', clienteFidelidadId, empresaId);
  if (!cliente.activo) return undefined;
  return { adultoMayor: !!cliente.tarjeta_adulto_mayor, lealtad: !!cliente.programa_lealtad };
}

async function buscarProductos(empresaId, { q, sucursal_id, cliente_fidelidad_id }) {
  const conn = await pool.getConnection();
  try {
    const suc = await getScoped(conn, 'sucursales', sucursal_id, empresaId);
    const clienteFlags = await resolverClienteFidelidad(conn, empresaId, cliente_fidelidad_id);
    const texto = (q || '').trim();
    if (!texto) return [];

    // 1º ¿el texto es un EAN/SKU exacto? Resuelve a qué producto pertenece (ya
    // sea el EAN del producto o el de una de sus presentaciones) y regresa
    // TODAS sus presentaciones activas — así escanear el código del vitrolero
    // también ofrece "vender pieza" en vez de agregarlo directo al carrito.
    const [[match]] = await conn.query(
      `SELECT p.id FROM productos p WHERE p.ean = ? OR p.sku_interno = ?
       UNION
       SELECT pp.producto_id FROM producto_presentaciones pp WHERE pp.ean = ? AND pp.activo_pos = 1
       LIMIT 1`,
      [texto, texto, texto]
    );
    if (match) {
      const sqlExacto = sqlBusqueda('p.id = ?', 'p.id = ?');
      const [exactos] = await conn.query(
        sqlExacto + ' ORDER BY presentacion_id IS NULL DESC, factor_conversion',
        [suc.almacen_id, match.id, suc.almacen_id, match.id]
      );
      if (exactos.length) return await decorarPromos(conn, empresaId, exactos.map((r) => ({ ...r, match: 'exacto' })), clienteFlags);
    }

    // 2º búsqueda por texto en descripción / SKU / nombre de presentación
    // ("paleta" o "vitrolero" deben encontrar la presentación correspondiente).
    const like = `%${texto}%`;
    const sqlTexto = sqlBusqueda(
      'p.descripcion LIKE ? OR p.sku_interno LIKE ?',
      'p.descripcion LIKE ? OR pp.nombre LIKE ? OR p.sku_interno LIKE ?'
    );
    const [parecidos] = await conn.query(
      sqlTexto + ' ORDER BY descripcion LIMIT 15',
      [suc.almacen_id, like, like, suc.almacen_id, like, like, like]
    );
    return await decorarPromos(conn, empresaId, parecidos.map((r) => ({ ...r, match: 'texto' })), clienteFlags);
  } finally {
    conn.release();
  }
}

// Alta rápida de existencia desde el mostrador: el producto YA existe en el
// catálogo pero no tiene piezas capturadas en este almacén (típico cuando
// llega mercancía y se vende antes de pasar por Inventario > Movimientos).
// Reutiliza registrarEntrada tal cual lo hace Movimientos, sin ubicación
// (igual que el reingreso de cancelarVenta) para no obligar al cajero a
// conocer el layout del almacén; exige lote si el producto lo controla.
async function registrarExistencia(empresaId, {
  sucursal_id, producto_id, presentacion_id = null, cantidad,
  costo_unitario = 0, numero_lote = null, fecha_caducidad = null, usuario_id,
}) {
  const cant = parseFloat(cantidad);
  if (!(cant > 0)) throw Object.assign(new Error('Cantidad debe ser > 0'), { status: 400 });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const sucursal = await getScoped(conn, 'sucursales', sucursal_id, empresaId);
    const [[prod]] = await conn.query(
      `SELECT id, descripcion, sku_interno, ean, precio_lista, clasificacion_cofepris,
              control_lote_caducidad
       FROM productos WHERE id = ? AND activo = 1 AND vendible = 1`,
      [producto_id]
    );
    if (!prod) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });

    let factor = 1, presentacion = null;
    if (presentacion_id) {
      const [[pp]] = await conn.query(
        `SELECT id, nombre, ean, precio_lista, factor_conversion
         FROM producto_presentaciones WHERE id = ? AND producto_id = ? AND activo_pos = 1`,
        [presentacion_id, producto_id]
      );
      if (!pp) throw Object.assign(new Error('Presentación no encontrada'), { status: 404 });
      presentacion = pp;
      factor = Number(pp.factor_conversion);
    }

    // El kardex siempre se mueve en piezas (ver EXISTENCIA_SUB arriba): si el
    // cajero contó "3 vitroleros", entran 3*factor piezas al costo por pieza.
    const cantidadPiezas = Math.round(cant * factor * 10000) / 10000;
    const costo = parseFloat(costo_unitario) || 0;
    const costoUnitarioPieza = Math.round((costo / factor) * 10000) / 10000;

    const { folio } = await inv.registrarEntrada(conn, {
      producto_id, almacen_id: sucursal.almacen_id, ubicacion_id: null,
      cantidad: cantidadPiezas, costo_unitario: costoUnitarioPieza,
      numero_lote, fecha_caducidad, motivo: 'alta_pos', referencia: null, usuario_id,
    });

    const [[{ existencia }]] = await conn.query(
      `SELECT COALESCE(SUM(l.cantidad_actual), 0) AS existencia FROM inventario_lotes l
       WHERE l.producto_id = ? AND l.almacen_id = ?`,
      [producto_id, sucursal.almacen_id]
    );
    await conn.commit();

    return {
      folio,
      producto: {
        producto_id: prod.id,
        presentacion_id: presentacion_id || null,
        descripcion: presentacion ? `${prod.descripcion} - ${presentacion.nombre}` : prod.descripcion,
        sku_interno: prod.sku_interno,
        ean: presentacion ? presentacion.ean : prod.ean,
        precio_lista: presentacion ? (presentacion.precio_lista ?? prod.precio_lista * factor) : prod.precio_lista,
        factor_conversion: factor,
        clasificacion_cofepris: prod.clasificacion_cofepris,
        control_lote_caducidad: prod.control_lote_caducidad,
        existencia,
      },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function favoritos(empresaId, { sucursal_id, cliente_fidelidad_id }) {
  const conn = await pool.getConnection();
  try {
    const suc = await getScoped(conn, 'sucursales', sucursal_id, empresaId);
    const clienteFlags = await resolverClienteFidelidad(conn, empresaId, cliente_fidelidad_id);
    const raw = typeof suc.productos_favoritos === 'string'
      ? JSON.parse(suc.productos_favoritos || '[]')
      : (suc.productos_favoritos || []);
    // Compat: formato anterior era un array plano de producto_id; ahora cada
    // entrada puede ser {id, color} para el resaltado configurable, y
    // opcionalmente {presentacion_id} cuando el favorito apunta a una
    // presentación específica (ej. "Paleta suelta") y no al producto base.
    const entradas = raw
      .map((e) => (e && typeof e === 'object')
        ? { id: Number(e.id), color: e.color || null, presentacion_id: e.presentacion_id ? Number(e.presentacion_id) : null }
        : { id: Number(e), color: null, presentacion_id: null })
      .filter((e) => e.id);
    if (!entradas.length) return [];
    const ids = entradas.map((e) => e.id);
    const presentacionIds = entradas.map((e) => e.presentacion_id).filter(Boolean);

    const [rows] = await conn.query(
      `SELECT ${CAMPOS_PRODUCTO_BASE}
       FROM productos p
       WHERE p.activo = 1 AND p.vendible = 1 AND p.id IN (?)`,
      [suc.almacen_id, ids]
    );
    let filasPresentacion = [];
    if (presentacionIds.length) {
      [filasPresentacion] = await conn.query(
        `SELECT ${CAMPOS_PRESENTACION}
         FROM producto_presentaciones pp
         JOIN productos p ON p.id = pp.producto_id
         WHERE p.activo = 1 AND p.vendible = 1 AND pp.activo_pos = 1 AND pp.id IN (?)`,
        [suc.almacen_id, presentacionIds]
      );
    }
    // Conserva el orden configurado por el admin (FIELD() en el ORDER BY sería
    // más simple, pero re-ordenar en JS evita depender de la posición en la lista).
    const porProducto = new Map(rows.map((r) => [r.producto_id, r]));
    const porPresentacion = new Map(filasPresentacion.map((r) => [r.presentacion_id, r]));
    const favoritosResueltos = entradas
      .map((e) => {
        const p = e.presentacion_id ? porPresentacion.get(e.presentacion_id) : porProducto.get(e.id);
        return p ? { ...p, color: e.color } : null;
      })
      .filter(Boolean);
    return await decorarPromos(conn, empresaId, favoritosResueltos, clienteFlags);
  } finally {
    conn.release();
  }
}

async function cargarVenta(conn, empresaId, ventaId) {
  const venta = await getScoped(conn, 'pos_ventas', ventaId, empresaId);
  const [partidas] = await conn.query(
    `SELECT pp.*, r.folio_receta, r.paciente_nombre, m.nombre AS medico, m.cedula_profesional
     FROM pos_ventas_partidas pp
     LEFT JOIN pos_recetas r ON r.id = pp.receta_id
     LEFT JOIN medicos m ON m.id = r.medico_id
     WHERE pp.venta_id = ?`,
    [ventaId]
  );
  const [[extra]] = await conn.query(
    `SELECT s.nombre AS sucursal, s.direccion AS sucursal_direccion, c.nombre AS caja, u.nombre AS cajero,
            cf.nombre AS cliente_fidelidad_nombre
     FROM pos_ventas v
     JOIN sucursales s ON s.id = v.sucursal_id
     JOIN pos_cajas c ON c.id = v.caja_id
     JOIN usuarios u ON u.id = v.usuario_id
     LEFT JOIN pos_clientes_fidelidad cf ON cf.id = v.cliente_fidelidad_id
     WHERE v.id = ?`,
    [ventaId]
  );
  return { ...venta, ...extra, partidas };
}

async function crearVenta(empresaId, payload) {
  const {
    client_uuid = null, turno_id, partidas = [], pagos = {}, receta = null, usuario_id,
    cliente_fidelidad_id = null,
  } = payload;

  // Idempotencia: si el uuid ya existe, devolver la venta original.
  if (client_uuid) {
    const [[ya]] = await pool.query(
      'SELECT id FROM pos_ventas WHERE client_uuid = ? AND empresa_id = ?',
      [client_uuid, empresaId]
    );
    if (ya) {
      const conn = await pool.getConnection();
      try { return { venta: await cargarVenta(conn, empresaId, ya.id), repetida: true }; }
      finally { conn.release(); }
    }
  }

  if (!Array.isArray(partidas) || !partidas.length) {
    throw Object.assign(new Error('La venta no tiene partidas'), { status: 400 });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Turno abierto y pertenencia del tenant; de la sucursal sale el almacén.
    const turno = await getScoped(conn, 'pos_turnos', turno_id, empresaId, { forUpdate: true });
    if (turno.estatus !== 'abierto') {
      throw Object.assign(new Error('El turno está cerrado; abre un turno para vender'), { status: 409 });
    }
    const caja = await getScoped(conn, 'pos_cajas', turno.caja_id, empresaId);
    const sucursal = await getScoped(conn, 'sucursales', caja.sucursal_id, empresaId);

    // Cliente de fidelidad ligado a la venta (migrate_v47, opcional): resuelto
    // aquí dentro de la transacción (tenant-scoped, ignora clientes dados de
    // baja) para que las promociones con requiere_cliente lo consideren.
    const clienteFlags = await resolverClienteFidelidad(conn, empresaId, cliente_fidelidad_id);

    // Promociones vigentes hoy para los productos de esta venta — una sola
    // consulta para toda la venta (no por partida). Mutuamente excluyente con
    // el precio editado a mano (ver abajo): si el cajero ya fijó un precio,
    // esa línea no recibe además un descuento automático.
    const promos = await promociones.descuentosPara(
      conn, empresaId, partidas.map((p) => Number(p.producto_id)), undefined, clienteFlags
    );

    // Catálogo de productos/presentaciones de TODA la venta en dos consultas
    // (no una por partida) — mismo criterio que promociones.descuentosPara arriba.
    const productoIdsVenta = [...new Set(partidas.map((p) => Number(p.producto_id)))];
    const [prodRowsVenta] = await conn.query(
      `SELECT id, descripcion, precio_lista, clasificacion_cofepris, ieps, iva_exento, vendible
       FROM productos WHERE id IN (?) AND activo = 1`,
      [productoIdsVenta]
    );
    const productosPorId = new Map(prodRowsVenta.map((r) => [r.id, r]));

    const presentacionIdsVenta = [...new Set(partidas.filter((p) => p.presentacion_id).map((p) => Number(p.presentacion_id)))];
    let presentacionesPorId = new Map();
    if (presentacionIdsVenta.length) {
      const [presRowsVenta] = await conn.query(
        `SELECT id, producto_id, nombre, factor_conversion, precio_lista FROM producto_presentaciones
         WHERE id IN (?) AND activo_pos = 1`,
        [presentacionIdsVenta]
      );
      presentacionesPorId = new Map(presRowsVenta.map((r) => [r.id, r]));
    }

    // Validar partidas contra el catálogo (snapshot de precio/clasificación).
    let subtotal = 0; let iva = 0; let descuentoTotal = 0;
    const partidasValidadas = [];
    const requierenReceta = [];
    for (const p of partidas) {
      const cantidad = Number(p.cantidad);
      if (!(cantidad > 0)) {
        throw Object.assign(new Error('Cantidad inválida en una partida'), { status: 400 });
      }
      const prod = productosPorId.get(Number(p.producto_id));
      if (!prod) {
        throw Object.assign(new Error(`Producto ${p.producto_id} no existe o está inactivo`), { status: 400 });
      }
      if (!prod.vendible) {
        throw Object.assign(new Error(`"${prod.descripcion}" no está marcado como vendible (sin precio de venta capturado)`), { status: 400 });
      }

      // Presentación de venta (pieza/vitrolero, ver migrate_v39): comparten la
      // MISMA existencia (siempre en piezas), pero cada una tiene su propio
      // precio y factor de conversión a piezas. Sin presentacion_id se vende
      // el producto tal cual (factor 1, comportamiento idéntico al de antes).
      let descripcion = prod.descripcion;
      let factorConversion = 1;
      let presentacionNombre = null;
      let precioCatalogo = Number(prod.precio_lista);
      if (p.presentacion_id) {
        const pres = presentacionesPorId.get(Number(p.presentacion_id));
        if (!pres || pres.producto_id !== Number(p.producto_id)) {
          throw Object.assign(new Error(`La presentación seleccionada para "${prod.descripcion}" ya no está disponible`), { status: 400 });
        }
        factorConversion = Number(pres.factor_conversion);
        presentacionNombre = pres.nombre;
        descripcion = `${prod.descripcion} - ${pres.nombre}`;
        precioCatalogo = pres.precio_lista != null ? Number(pres.precio_lista) : prod.precio_lista * factorConversion;
      }

      const huboOverrideManual = p.precio_unitario !== undefined && p.precio_unitario !== null;
      const precio = Number(p.precio_unitario ?? precioCatalogo);
      if (!(precio > 0)) {
        throw Object.assign(new Error(`El producto "${descripcion}" no tiene precio de venta`), { status: 400 });
      }

      let precioOriginal = null;
      let motivoCambioPrecio = null;
      let descuento = 0;
      let promocionId = null;
      if (huboOverrideManual) {
        // Precio editable en el mostrador (migrate_v45): el cajero puede
        // cobrar distinto al de catálogo por cualquier situación, sin
        // autorización de supervisor, pero el backend exige un motivo — es
        // la fuente de verdad, no la UI (mismo principio que "controlados
        // sin receta" abajo). Esta línea NO recibe además un descuento de
        // promoción: el precio a mano ya es el final (ver
        // pos.promociones.service.js).
        if (Math.abs(precio - precioCatalogo) > 0.005) {
          const motivo = (p.motivo_precio || '').trim();
          if (!motivo) {
            throw Object.assign(
              new Error(`Se requiere un motivo para modificar el precio de "${descripcion}"`),
              { status: 400 }
            );
          }
          precioOriginal = precioCatalogo;
          motivoCambioPrecio = motivo;
        }
      } else {
        // Promoción automática (migrate_v46): el % más alto vigente hoy para
        // este producto, si hay alguna. El cajero no hace nada.
        const promo = promos.get(prod.id);
        if (promo) {
          const pct = Math.min(Math.max(Number(promo.pct), 0), 100);
          // Redondear el precio unitario CON promoción primero (misma fórmula
          // que decorarPromos, lo que ve el cajero antes de cobrar) y derivar
          // el descuento de ahí — no redondear el descuento agregado aparte:
          // con cantidad > 1 ambos caminos pueden diferir por un centavo y
          // desincronizar el total que el cajero ya vio contra el que calcula
          // el servidor (rompe "Todo con tarjeta" con un pago "insuficiente").
          const precioConPromo = Math.round(precio * (1 - pct / 100) * 100) / 100;
          descuento = Math.round((precio - precioConPromo) * cantidad * 100) / 100;
          promocionId = promo.promocion_id;
        }
      }
      const importe = Math.round((cantidad * precio - descuento) * 100) / 100;
      if (importe < 0) {
        throw Object.assign(new Error('Descuento mayor que el importe'), { status: 400 });
      }
      // Medicamentos (iva_exento=1) = TASA 0 (decisión del contador 2026-07-11:
      // TaxObject 02 Rate 0.000000, NO exento). Resto: 16% incluido en precio de lista.
      const ivaTasa = prod.iva_exento ? 0 : 0.16;
      const importeSinIva = Math.round((importe / (1 + ivaTasa)) * 100) / 100;
      subtotal += importeSinIva;
      iva += importe - importeSinIva;
      descuentoTotal += descuento;

      if (!CLASIF_LIBRES.includes(prod.clasificacion_cofepris)) {
        requierenReceta.push(descripcion);
      }
      partidasValidadas.push({
        producto_id: prod.id,
        descripcion,
        cantidad,
        precio_unitario: precio,
        precio_original: precioOriginal,
        motivo_cambio_precio: motivoCambioPrecio,
        promocion_id: promocionId,
        descuento,
        iva_tasa: ivaTasa,
        importe,
        clasificacion_cofepris: prod.clasificacion_cofepris,
        presentacion_id: p.presentacion_id || null,
        presentacion_nombre: presentacionNombre,
        factor_conversion: factorConversion,
        piezas_equivalentes: Math.round(cantidad * factorConversion * 100) / 100,
      });
    }
    subtotal = Math.round(subtotal * 100) / 100;
    iva = Math.round(iva * 100) / 100;
    descuentoTotal = Math.round(descuentoTotal * 100) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;

    // Controlados: sin receta no hay venta (el server es la fuente de verdad).
    if (requierenReceta.length && !receta) {
      throw Object.assign(
        new Error('Estos productos requieren receta médica'),
        { status: 422, productos: requierenReceta }
      );
    }

    // Pagos: efectivo + tarjeta >= total; la tarjeta nunca excede el total.
    const efectivo = Math.round(Number(pagos.efectivo || 0) * 100) / 100;
    const tarjeta = Math.round(Number(pagos.tarjeta || 0) * 100) / 100;
    if (efectivo < 0 || tarjeta < 0) {
      throw Object.assign(new Error('Pagos inválidos'), { status: 400 });
    }
    if (tarjeta > total) {
      throw Object.assign(new Error('El pago con tarjeta excede el total'), { status: 400 });
    }
    if (efectivo + tarjeta < total) {
      throw Object.assign(new Error('El pago no cubre el total'), { status: 400 });
    }
    const cambio = Math.round((efectivo - (total - tarjeta)) * 100) / 100;

    // Receta (si aplica): upsert de médico por (empresa, cédula) + registro.
    let recetaId = null;
    if (receta) {
      let medicoId = receta.medico_id || null;
      if (!medicoId && receta.medico_nuevo) {
        const mn = receta.medico_nuevo;
        if (!mn.nombre?.trim() || !mn.cedula_profesional?.trim()) {
          throw Object.assign(new Error('El médico requiere nombre y cédula profesional'), { status: 400 });
        }
        const [[existente]] = await conn.query(
          'SELECT id FROM medicos WHERE empresa_id = ? AND cedula_profesional = ?',
          [empresaId, mn.cedula_profesional.trim()]
        );
        if (existente) {
          medicoId = existente.id;
        } else {
          const [rm] = await conn.query(
            `INSERT INTO medicos (empresa_id, nombre, cedula_profesional, especialidad, institucion, telefono)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [empresaId, mn.nombre.trim(), mn.cedula_profesional.trim(),
             mn.especialidad || null, mn.institucion || null, mn.telefono || null]
          );
          medicoId = rm.insertId;
        }
      }
      if (!medicoId) {
        throw Object.assign(new Error('La receta requiere médico'), { status: 400 });
      }
      await getScoped(conn, 'medicos', medicoId, empresaId);
      if (!receta.paciente_nombre?.trim()) {
        throw Object.assign(new Error('La receta requiere nombre del paciente'), { status: 400 });
      }
      const [rr] = await conn.query(
        `INSERT INTO pos_recetas
           (empresa_id, folio_receta, medico_id, paciente_nombre, paciente_domicilio,
            fecha_receta, retenida, surtimiento, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, receta.folio_receta || null, medicoId, receta.paciente_nombre.trim(),
         receta.paciente_domicilio || null, receta.fecha_receta || new Date(),
         receta.retenida ? 1 : 0, receta.surtimiento || 1, usuario_id]
      );
      recetaId = rr.insertId;
    }

    // Folio + encabezado de la venta.
    // `descuento` aquí es la SUMA de los descuentos por promoción de las
    // partidas — un monto CON IVA incluido. `subtotal` en cambio ya está
    // NETO de IVA y NETO de descuento. No restar uno de otro en ningún
    // reporte (ver mismo comentario en pos.cfdi.service.js): sería un doble
    // descuento. No incluye precios editados a mano (esos ya son el precio
    // final, no pasan por `descuento`).
    const folio = await inv.genFolio(conn, 'POS');
    const [rv] = await conn.query(
      `INSERT INTO pos_ventas
         (empresa_id, sucursal_id, caja_id, turno_id, folio, client_uuid, cliente_id, cliente_fidelidad_id,
          subtotal, descuento, iva, total, pago_efectivo, pago_tarjeta, cambio, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, sucursal.id, caja.id, turno.id, folio, client_uuid, payload.cliente_id || null, cliente_fidelidad_id,
       subtotal, descuentoTotal, iva, total, efectivo, tarjeta, cambio, usuario_id]
    );
    const ventaId = rv.insertId;
    if (recetaId) {
      await conn.query('UPDATE pos_recetas SET venta_id = ? WHERE id = ?', [ventaId, recetaId]);
    }

    // Partidas + salida FEFO restringida al almacén de la sucursal.
    for (const p of partidasValidadas) {
      let salida;
      try {
        // El kardex siempre se mueve en piezas: 1 "Vitrolero" (factor 150)
        // descuenta 150 piezas del mismo contador que una "Pieza suelta"
        // (factor 1) — así una venta suelta reduce lo que queda disponible
        // para vender el paquete cerrado, sin lógica especial (ver migrate_v39).
        salida = await inv.registrarSalidaFEFO(conn, {
          producto_id: p.producto_id,
          cantidad: p.piezas_equivalentes,
          motivo: 'venta_pos',
          referencia: folio,
          usuario_id,
          almacen_id: sucursal.almacen_id,
        });
      } catch (e) {
        if (e.status === 400 && e.disponible !== undefined) {
          throw Object.assign(
            new Error(`Existencia insuficiente de "${p.descripcion}" en ${sucursal.nombre}`),
            { status: 409, producto: p.descripcion, disponible: e.disponible }
          );
        }
        throw e;
      }
      await conn.query(
        `INSERT INTO pos_ventas_partidas
           (empresa_id, venta_id, producto_id, presentacion_id, presentacion_nombre,
            descripcion, cantidad, factor_conversion, piezas_equivalentes, precio_unitario,
            precio_original, motivo_cambio_precio, promocion_id,
            descuento, iva_tasa, importe, clasificacion_cofepris, receta_id, lotes_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, ventaId, p.producto_id, p.presentacion_id, p.presentacion_nombre,
         p.descripcion, p.cantidad, p.factor_conversion, p.piezas_equivalentes, p.precio_unitario,
         p.precio_original, p.motivo_cambio_precio, p.promocion_id,
         p.descuento, p.iva_tasa, p.importe, p.clasificacion_cofepris,
         CLASIF_LIBRES.includes(p.clasificacion_cofepris) ? null : recetaId,
         JSON.stringify(salida.lotes)]
      );
    }

    await conn.commit();
    return { venta: await cargarVenta(conn, empresaId, ventaId), repetida: false };
  } catch (err) {
    await conn.rollback();
    // Carrera sobre el mismo client_uuid: el UNIQUE es el respaldo.
    if (err.code === 'ER_DUP_ENTRY' && client_uuid) {
      const [[ya]] = await pool.query(
        'SELECT id FROM pos_ventas WHERE client_uuid = ? AND empresa_id = ?',
        [client_uuid, empresaId]
      );
      if (ya) {
        const c2 = await pool.getConnection();
        try { return { venta: await cargarVenta(c2, empresaId, ya.id), repetida: true }; }
        finally { c2.release(); }
      }
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Cancela una venta SOLO si su turno sigue abierto y no tiene CFDI:
 * reingresa el inventario (entrada por lote consumido) y marca 'cancelada'.
 * Fuera de esas condiciones → 409 (se resuelve manualmente; nota de crédito
 * queda para Fase 2 — nunca se fuerza).
 */
async function cancelarVenta(empresaId, ventaId, { motivo, usuario_id }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const venta = await getScoped(conn, 'pos_ventas', ventaId, empresaId, { forUpdate: true });
    if (venta.estatus !== 'completada') {
      throw Object.assign(new Error('La venta ya está cancelada'), { status: 409 });
    }
    if (venta.factura_estado !== 'sin_factura' || venta.cfdi_id) {
      throw Object.assign(new Error('La venta ya tiene factura; se resuelve con nota de crédito (manual)'), { status: 409 });
    }
    const turno = await getScoped(conn, 'pos_turnos', venta.turno_id, empresaId);
    if (turno.estatus !== 'abierto') {
      throw Object.assign(new Error('El turno de la venta ya cerró; la cancelación es un proceso manual'), { status: 409 });
    }

    const sucursal = await getScoped(conn, 'sucursales', venta.sucursal_id, empresaId);
    const [partidas] = await conn.query(
      'SELECT * FROM pos_ventas_partidas WHERE venta_id = ?', [ventaId]
    );
    // Reingreso por lote exacto (lo que salió, regresa).
    for (const p of partidas) {
      const lotes = typeof p.lotes_json === 'string' ? JSON.parse(p.lotes_json || '[]') : (p.lotes_json || []);
      for (const l of lotes) {
        await inv.registrarEntrada(conn, {
          producto_id: p.producto_id,
          almacen_id: sucursal.almacen_id,
          ubicacion_id: null,
          cantidad: l.cantidad,
          numero_lote: l.lote,
          fecha_caducidad: l.caducidad ? String(l.caducidad).slice(0, 10) : null,
          motivo: 'cancelacion_pos',
          referencia: venta.folio,
          usuario_id,
          permitir_sin_lote: true,
        });
      }
    }
    await conn.query(
      `UPDATE pos_ventas SET estatus = 'cancelada', cancelada_en = NOW(),
        cancelada_por = ?, motivo_cancelacion = ? WHERE id = ?`,
      [usuario_id, motivo || null, ventaId]
    );
    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function detalleVenta(empresaId, ventaId) {
  const conn = await pool.getConnection();
  try { return await cargarVenta(conn, empresaId, ventaId); }
  finally { conn.release(); }
}

async function listarVentas(empresaId, { turno_id, desde, hasta, limit = 100 }) {
  const params = [empresaId];
  let where = 'v.empresa_id = ?';
  if (turno_id) { where += ' AND v.turno_id = ?'; params.push(turno_id); }
  if (desde) { where += ' AND v.created_at >= ?'; params.push(desde); }
  if (hasta) { where += ' AND v.created_at < DATE_ADD(?, INTERVAL 1 DAY)'; params.push(hasta); }
  const [rows] = await pool.query(
    `SELECT v.id, v.folio, v.total, v.pago_efectivo, v.pago_tarjeta, v.cambio,
            v.estatus, v.factura_estado, v.created_at,
            s.nombre AS sucursal, c.nombre AS caja, u.nombre AS cajero
     FROM pos_ventas v
     JOIN sucursales s ON s.id = v.sucursal_id
     JOIN pos_cajas c ON c.id = v.caja_id
     JOIN usuarios u ON u.id = v.usuario_id
     WHERE ${where}
     ORDER BY v.id DESC
     LIMIT ${Number(limit) || 100}`,
    params
  );
  return rows;
}

module.exports = { buscarProductos, registrarExistencia, favoritos, crearVenta, cancelarVenta, detalleVenta, listarVentas };
