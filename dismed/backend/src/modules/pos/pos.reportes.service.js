/**
 * pos.reportes.service.js — Dashboard/Reportes del POS Farmacia.
 * Grupo A (permiso 'pos-reportes'): operativos — ventas, sucursales, top
 * productos, formas de pago, existencias, recetas COFEPRIS.
 * Grupo B (permiso 'pos-reportes-ganancias'): ganancia/margen — separado
 * a propósito para que el admin decida quién los ve (igual que Descargas SAT).
 *
 * Costo de venta: se lee de inventario_movimientos (tipo='salida',
 * motivo='venta_pos', referencia=pos_ventas.folio), la misma fuente que usa
 * polizas.generator.js para el costo de venta contable. Las salidas se
 * guardan con cantidad NEGATIVA (ver inventario/movimientos.service.js
 * #registrarSalida), de ahí el ABS() en las sumas de costo.
 *
 * Todas las consultas van acotadas por pos_ventas.empresa_id / sucursales.empresa_id
 * (tenant). productos e inventario_movimientos no tienen empresa_id propio —
 * el catálogo es compartido, igual que en pos.ventas.service.js.
 */
const { pool } = require('../../config/db');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Entero acotado [min, max]; raw inválido/vacío/negativo cae en `def` antes de
// acotar, así un limit=-5 no llega a interpolarse como `LIMIT -5` (500 en vez de 400).
const clampInt = (raw, def, min, max) => Math.min(Math.max(Number(raw) || def, min), max);
const FORMATOS = { dia: '%Y-%m-%d', semana: '%x-W%v', mes: '%Y-%m' };

function httpError(msg, status = 400) { const e = new Error(msg); e.status = status; throw e; }

function resolverRango(f) {
  const hoy = new Date();
  const hastaDefault = hoy.toISOString().slice(0, 10);
  const desdeDefault = new Date(hoy.getTime() - 6 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const desde = f.desde || desdeDefault;
  const hasta = f.hasta || hastaDefault;
  if (desde > hasta) httpError('El rango de fechas es inválido (desde > hasta)');
  const agrupar = FORMATOS[f.agrupar] ? f.agrupar : 'dia';
  return { desde, hasta, agrupar };
}

async function empresaHeader(empresaId) {
  const [[e]] = await pool.query('SELECT nombre, rfc FROM empresas WHERE id = ?', [empresaId]);
  return e ? { nombre: e.nombre, rfc: e.rfc } : { nombre: null, rfc: null };
}

async function meta(empresaId, periodo, titulo, extra) {
  return {
    empresa: await empresaHeader(empresaId),
    titulo,
    periodo: { desde: periodo.desde, hasta: periodo.hasta, etiqueta: `${periodo.desde} al ${periodo.hasta}` },
    generado: new Date().toISOString(),
    ...extra,
  };
}

// Condición WHERE base + params, reutilizada por casi todos los reportes.
function condVentas({ empresaId, desde, hasta, sucursalId }) {
  const params = [empresaId, desde, hasta];
  let where = `v.empresa_id = ? AND v.estatus = 'completada'
    AND v.created_at >= ? AND v.created_at < DATE_ADD(?, INTERVAL 1 DAY)`;
  if (sucursalId) { where += ' AND v.sucursal_id = ?'; params.push(sucursalId); }
  return { where, params };
}

const NOTA_OPERATIVO = 'Reporte operativo del mostrador (POS), calculado sobre ventas completadas. ' +
  'No sustituye al Estado de Resultados de Contabilidad.';
const NOTA_GANANCIA = 'Ganancia = venta (importe cobrado) − costo de las salidas de inventario de esa ' +
  'venta (FEFO). Es un indicador operativo del mostrador; el Estado de Resultados de Contabilidad usa ' +
  'la misma fuente de costo pero con el resto de la contabilidad de la empresa.';

// ── Grupo A: operativos ─────────────────────────────────────────────────────

async function resumenVentas(empresaId, filtros) {
  const periodo = resolverRango(filtros);
  const sucursalId = filtros.sucursal_id || null;
  const { where, params } = condVentas({ empresaId, ...periodo, sucursalId });

  const [[kpi]] = await pool.query(
    `SELECT COUNT(*) AS num_tickets, COALESCE(SUM(v.total),0) AS total,
            COALESCE(SUM(v.pago_efectivo),0) AS efectivo, COALESCE(SUM(v.pago_tarjeta),0) AS tarjeta
     FROM pos_ventas v WHERE ${where}`,
    params
  );
  const [serie] = await pool.query(
    `SELECT DATE_FORMAT(v.created_at, ?) AS periodo, COUNT(*) AS num_tickets, COALESCE(SUM(v.total),0) AS total
     FROM pos_ventas v WHERE ${where}
     GROUP BY periodo ORDER BY periodo`,
    [FORMATOS[periodo.agrupar], ...params]
  );

  const numTickets = Number(kpi.num_tickets) || 0;
  return {
    ...(await meta(empresaId, periodo, 'Resumen de ventas', { reporte: 'resumen_ventas' })),
    kpi: {
      num_tickets: numTickets,
      total: r2(kpi.total),
      ticket_promedio: numTickets ? r2(kpi.total / numTickets) : 0,
      efectivo: r2(kpi.efectivo),
      tarjeta: r2(kpi.tarjeta),
    },
    serie: serie.map((s) => ({ periodo: s.periodo, num_tickets: s.num_tickets, total: r2(s.total) })),
    nota: NOTA_OPERATIVO,
  };
}

async function ventasPorSucursal(empresaId, filtros) {
  const periodo = resolverRango(filtros);
  const { where, params } = condVentas({ empresaId, ...periodo, sucursalId: filtros.sucursal_id || null });

  const [rows] = await pool.query(
    `SELECT s.id AS sucursal_id, s.nombre AS sucursal, COUNT(*) AS num_tickets, COALESCE(SUM(v.total),0) AS total
     FROM pos_ventas v JOIN sucursales s ON s.id = v.sucursal_id
     WHERE ${where}
     GROUP BY s.id, s.nombre ORDER BY total DESC`,
    params
  );
  return {
    ...(await meta(empresaId, periodo, 'Ventas por sucursal', { reporte: 'ventas_sucursal' })),
    rows: rows.map((r) => ({
      ...r, total: r2(r.total),
      ticket_promedio: r.num_tickets ? r2(r.total / r.num_tickets) : 0,
    })),
    nota: NOTA_OPERATIVO,
  };
}

async function topProductos(empresaId, filtros) {
  const periodo = resolverRango(filtros);
  const { where, params } = condVentas({ empresaId, ...periodo, sucursalId: filtros.sucursal_id || null });
  const limit = clampInt(filtros.limit, 20, 1, 100);

  const [rows] = await pool.query(
    `SELECT pp.producto_id, pp.descripcion, SUM(pp.piezas_equivalentes) AS cantidad,
            COALESCE(SUM(pp.importe),0) AS importe, COALESCE(SUM(pp.descuento),0) AS descuento
     FROM pos_ventas_partidas pp JOIN pos_ventas v ON v.id = pp.venta_id
     WHERE ${where}
     GROUP BY pp.producto_id, pp.descripcion
     ORDER BY importe DESC LIMIT ${limit}`,
    params
  );
  return {
    ...(await meta(empresaId, periodo, 'Productos más vendidos', { reporte: 'top_productos' })),
    rows: rows.map((r) => ({ ...r, cantidad: Number(r.cantidad), importe: r2(r.importe), descuento: r2(r.descuento) })),
    nota: NOTA_OPERATIVO,
  };
}

// Venta detallada por producto con EAN y proveedor(es), pensado para armar
// pedidos de compra a partir de lo que se va vendiendo. El proveedor sale de
// proveedores_catalogo (match_estado='confirmado'); un producto puede tener
// más de un proveedor confirmado en el tarifario, por eso se agrupan con
// GROUP_CONCAT en vez de unir directo (evitaría duplicar/inflar la cantidad
// vendida por el fan-out del JOIN — ambas subconsultas van pre-agregadas por
// producto_id antes de unirse 1:1).
async function ventasDetalladoProducto(empresaId, filtros) {
  const periodo = resolverRango(filtros);
  const sucursalId = filtros.sucursal_id || null;
  const { where, params } = condVentas({ empresaId, ...periodo, sucursalId });
  const limit = clampInt(filtros.limit, 500, 1, 2000);

  const [rows] = await pool.query(
    `SELECT vp.producto_id, p.sku_interno, p.ean, vp.descripcion, vp.cantidad, vp.importe,
            prov.proveedores
     FROM (
       SELECT pp.producto_id, MAX(pp.descripcion) AS descripcion,
              SUM(pp.piezas_equivalentes) AS cantidad, COALESCE(SUM(pp.importe),0) AS importe
       FROM pos_ventas_partidas pp JOIN pos_ventas v ON v.id = pp.venta_id
       WHERE ${where}
       GROUP BY pp.producto_id
     ) vp
     JOIN productos p ON p.id = vp.producto_id
     LEFT JOIN (
       SELECT pc.producto_id,
              GROUP_CONCAT(DISTINCT pr.nombre_empresa ORDER BY pr.nombre_empresa SEPARATOR ', ') AS proveedores
       FROM proveedores_catalogo pc JOIN proveedores pr ON pr.id = pc.proveedor_id
       WHERE pc.match_estado = 'confirmado' AND pc.activo = 1
       GROUP BY pc.producto_id
     ) prov ON prov.producto_id = vp.producto_id
     ORDER BY vp.cantidad DESC LIMIT ${limit}`,
    params
  );
  return {
    ...(await meta(empresaId, periodo, 'Venta detallada por producto', { reporte: 'ventas_producto' })),
    rows: rows.map((r) => ({
      producto_id: r.producto_id,
      sku_interno: r.sku_interno,
      ean: r.ean || '',
      descripcion: r.descripcion,
      proveedor: r.proveedores || 'Sin proveedor asignado',
      cantidad: Number(r.cantidad),
      importe: r2(r.importe),
    })),
    nota: NOTA_OPERATIVO + ' El proveedor mostrado es el vinculado en el catálogo de proveedores ' +
      '(Proveedores → Catálogo, match confirmado); si un producto tiene más de un proveedor confirmado ' +
      'se listan todos separados por coma. Úsalo como base para armar pedidos de compra.',
  };
}

// Lista de tickets del periodo, para que el usuario pueda verificar el
// detalle contra el conteo agregado de resumenVentas (mismo condVentas,
// mismo criterio de "número de ventas" que Turnos/corte de caja). El detalle
// de cada ticket se consulta aparte con ventas.detalleVenta (pos.controller.js),
// no se reimplementa aquí.
async function tickets(empresaId, filtros) {
  const periodo = resolverRango(filtros);
  const sucursalId = filtros.sucursal_id || null;
  const { where, params } = condVentas({ empresaId, ...periodo, sucursalId });
  const limit = clampInt(filtros.limit, 500, 1, 2000);

  const [rows] = await pool.query(
    `SELECT v.id, v.folio, v.created_at, s.nombre AS sucursal, c.nombre AS caja, u.nombre AS cajero,
            v.total, v.pago_efectivo, v.pago_tarjeta,
            (SELECT COUNT(*) FROM pos_ventas_partidas pp WHERE pp.venta_id = v.id) AS num_partidas,
            (SELECT COALESCE(SUM(pp.cantidad),0) FROM pos_ventas_partidas pp WHERE pp.venta_id = v.id) AS num_piezas
     FROM pos_ventas v
     JOIN sucursales s ON s.id = v.sucursal_id
     JOIN pos_cajas c ON c.id = v.caja_id
     JOIN usuarios u ON u.id = v.usuario_id
     WHERE ${where}
     ORDER BY v.created_at DESC LIMIT ${limit}`,
    params
  );
  return {
    ...(await meta(empresaId, periodo, 'Tickets por fecha', { reporte: 'tickets' })),
    rows: rows.map((r) => ({
      id: r.id, folio: r.folio, created_at: r.created_at, sucursal: r.sucursal, caja: r.caja, cajero: r.cajero,
      total: r2(r.total), pago_efectivo: r2(r.pago_efectivo), pago_tarjeta: r2(r.pago_tarjeta),
      num_partidas: Number(r.num_partidas), num_piezas: Number(r.num_piezas),
    })),
    nota: NOTA_OPERATIVO + ' Da clic en un ticket para ver el detalle de lo que incluyó.',
  };
}

async function formasPago(empresaId, filtros) {
  const periodo = resolverRango(filtros);
  const { where, params } = condVentas({ empresaId, ...periodo, sucursalId: filtros.sucursal_id || null });

  const [[r]] = await pool.query(
    `SELECT
       SUM(CASE WHEN v.pago_tarjeta = 0 THEN 1 ELSE 0 END) AS tickets_efectivo,
       SUM(CASE WHEN v.pago_efectivo = 0 AND v.pago_tarjeta > 0 THEN 1 ELSE 0 END) AS tickets_tarjeta,
       SUM(CASE WHEN v.pago_efectivo > 0 AND v.pago_tarjeta > 0 THEN 1 ELSE 0 END) AS tickets_mixto,
       COALESCE(SUM(v.pago_efectivo),0) AS monto_efectivo, COALESCE(SUM(v.pago_tarjeta),0) AS monto_tarjeta
     FROM pos_ventas v WHERE ${where}`,
    params
  );
  const montoTotal = r2(Number(r.monto_efectivo) + Number(r.monto_tarjeta));
  return {
    ...(await meta(empresaId, periodo, 'Ventas por forma de pago', { reporte: 'formas_pago' })),
    tickets: {
      efectivo: Number(r.tickets_efectivo) || 0,
      tarjeta: Number(r.tickets_tarjeta) || 0,
      mixto: Number(r.tickets_mixto) || 0,
    },
    montos: {
      efectivo: r2(r.monto_efectivo), tarjeta: r2(r.monto_tarjeta), total: montoTotal,
      pct_efectivo: montoTotal ? r2((r.monto_efectivo / montoTotal) * 100) : 0,
      pct_tarjeta: montoTotal ? r2((r.monto_tarjeta / montoTotal) * 100) : 0,
    },
    nota: NOTA_OPERATIVO,
  };
}

async function existencias(empresaId, filtros) {
  const sucursalId = filtros.sucursal_id || null;
  const diasCaducidad = clampInt(filtros.dias_caducidad, 90, 1, 365);

  const params = [empresaId];
  let whereSuc = 'empresa_id = ? AND activo = 1';
  if (sucursalId) { whereSuc += ' AND id = ?'; params.push(sucursalId); }
  const [sucursales] = await pool.query(
    `SELECT id, nombre, almacen_id FROM sucursales WHERE ${whereSuc} ORDER BY nombre`, params
  );

  const base = {
    empresa: await empresaHeader(empresaId),
    titulo: 'Existencias por sucursal',
    reporte: 'existencias',
    generado: new Date().toISOString(),
    filtros: { sucursal_id: sucursalId, dias_caducidad: diasCaducidad },
    nota: NOTA_OPERATIVO,
  };
  const almacenIds = sucursales.map((s) => s.almacen_id);
  if (!almacenIds.length) return { ...base, por_sucursal: [], stock_bajo: [], por_caducar: [] };

  const nombreSucursal = (almacenId) => sucursales.find((s) => s.almacen_id === almacenId)?.nombre || null;

  const [totales] = await pool.query(
    `SELECT il.almacen_id, COUNT(DISTINCT il.producto_id) AS num_productos, COALESCE(SUM(il.cantidad_actual),0) AS unidades
     FROM inventario_lotes il WHERE il.almacen_id IN (?) AND il.cantidad_actual > 0 GROUP BY il.almacen_id`,
    [almacenIds]
  );
  const porSucursal = sucursales.map((s) => {
    const t = totales.find((x) => x.almacen_id === s.almacen_id);
    return { sucursal_id: s.id, sucursal: s.nombre, num_productos: t ? Number(t.num_productos) : 0, unidades: t ? r2(t.unidades) : 0 };
  });

  const [stockBajo] = await pool.query(
    `SELECT il.almacen_id, p.id AS producto_id, p.sku_interno, p.descripcion, p.stock_minimo,
            SUM(il.cantidad_actual) AS existencia
     FROM inventario_lotes il JOIN productos p ON p.id = il.producto_id
     WHERE il.almacen_id IN (?)
     GROUP BY il.almacen_id, p.id, p.sku_interno, p.descripcion, p.stock_minimo
     HAVING p.stock_minimo > 0 AND existencia < p.stock_minimo
     ORDER BY existencia ASC LIMIT 100`,
    [almacenIds]
  );

  const [porCaducar] = await pool.query(
    `SELECT il.almacen_id, p.sku_interno, p.descripcion, il.numero_lote, il.fecha_caducidad, il.cantidad_actual
     FROM inventario_lotes il JOIN productos p ON p.id = il.producto_id
     WHERE il.almacen_id IN (?) AND il.cantidad_actual > 0 AND il.fecha_caducidad IS NOT NULL
       AND il.fecha_caducidad <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
     ORDER BY il.fecha_caducidad ASC LIMIT 200`,
    [almacenIds, diasCaducidad]
  );

  return {
    ...base,
    por_sucursal: porSucursal,
    stock_bajo: stockBajo.map((r) => ({
      ...r, sucursal: nombreSucursal(r.almacen_id), existencia: r2(r.existencia), stock_minimo: r2(r.stock_minimo),
    })),
    por_caducar: porCaducar.map((r) => ({
      ...r, sucursal: nombreSucursal(r.almacen_id), cantidad_actual: r2(r.cantidad_actual),
    })),
  };
}

async function recetasCofepris(empresaId, filtros) {
  const periodo = resolverRango(filtros);
  const sucursalId = filtros.sucursal_id || null;
  const params = [empresaId, periodo.desde, periodo.hasta];
  let where = `v.empresa_id = ? AND v.estatus = 'completada'
    AND v.created_at >= ? AND v.created_at < DATE_ADD(?, INTERVAL 1 DAY)
    AND pp.clasificacion_cofepris NOT IN ('libre', 'venta_farmacia')`;
  if (sucursalId) { where += ' AND v.sucursal_id = ?'; params.push(sucursalId); }

  const [rows] = await pool.query(
    `SELECT pp.clasificacion_cofepris, COUNT(*) AS partidas, COALESCE(SUM(pp.piezas_equivalentes),0) AS unidades
     FROM pos_ventas_partidas pp JOIN pos_ventas v ON v.id = pp.venta_id
     WHERE ${where}
     GROUP BY pp.clasificacion_cofepris ORDER BY partidas DESC`,
    params
  );
  return {
    ...(await meta(empresaId, periodo, 'Recetas dispensadas (COFEPRIS)', { reporte: 'recetas_cofepris' })),
    rows: rows.map((r) => ({ ...r, unidades: r2(r.unidades) })),
    nota: NOTA_OPERATIVO + ' Excluye productos de venta libre.',
  };
}

// ── Grupo B: ganancia/margen (permiso separado) ─────────────────────────────

// Subconsulta de costo: salidas de inventario ligadas a la venta por folio +
// producto (cantidad se guarda negativa en las salidas, de ahí ABS()).
function subconsultaCosto(periodo) {
  return {
    sql: `SELECT im.referencia AS folio, im.producto_id, SUM(ABS(im.cantidad) * im.costo_unitario) AS costo
          FROM inventario_movimientos im
          WHERE im.tipo = 'salida' AND im.motivo = 'venta_pos'
            AND im.created_at >= ? AND im.created_at < DATE_ADD(?, INTERVAL 1 DAY)
          GROUP BY im.referencia, im.producto_id`,
    params: [periodo.desde, periodo.hasta],
  };
}

// Partidas pre-agregadas por (venta_id, producto_id): inventario_movimientos
// no tiene partida_id, solo folio+producto_id, así que si una venta repite el
// mismo producto en dos partidas hay que sumarlas ANTES de unir con el costo
// — de lo contrario el join replica la fila de costo por cada partida y el
// costo se cuenta de más (encontrado en code review).
const SQL_PARTIDAS_AGRUPADAS = `
  SELECT venta_id, producto_id, MAX(descripcion) AS descripcion,
         SUM(importe) AS importe, SUM(cantidad) AS cantidad, SUM(descuento) AS descuento
  FROM pos_ventas_partidas GROUP BY venta_id, producto_id`;

async function ganancias(empresaId, filtros) {
  const periodo = resolverRango(filtros);
  const sucursalId = filtros.sucursal_id || null;
  const { where, params } = condVentas({ empresaId, ...periodo, sucursalId });
  const costoSub = subconsultaCosto(periodo);

  const [[kpi]] = await pool.query(
    `SELECT COALESCE(SUM(ppa.importe),0) AS venta, COALESCE(SUM(costo.costo),0) AS costo,
            COALESCE(SUM(ppa.descuento),0) AS descuento
     FROM pos_ventas v
     JOIN (${SQL_PARTIDAS_AGRUPADAS}) ppa ON ppa.venta_id = v.id
     LEFT JOIN (${costoSub.sql}) costo ON costo.folio = v.folio COLLATE utf8mb4_general_ci AND costo.producto_id = ppa.producto_id
     WHERE ${where}`,
    [...costoSub.params, ...params]
  );
  const [serie] = await pool.query(
    `SELECT DATE_FORMAT(v.created_at, ?) AS periodo,
            COALESCE(SUM(ppa.importe),0) AS venta, COALESCE(SUM(costo.costo),0) AS costo
     FROM pos_ventas v
     JOIN (${SQL_PARTIDAS_AGRUPADAS}) ppa ON ppa.venta_id = v.id
     LEFT JOIN (${costoSub.sql}) costo ON costo.folio = v.folio COLLATE utf8mb4_general_ci AND costo.producto_id = ppa.producto_id
     WHERE ${where}
     GROUP BY periodo ORDER BY periodo`,
    [FORMATOS[periodo.agrupar], ...costoSub.params, ...params]
  );

  const venta = r2(kpi.venta); const costo = r2(kpi.costo); const ganancia = r2(venta - costo);
  return {
    ...(await meta(empresaId, periodo, 'Ganancia / margen', { reporte: 'ganancias' })),
    kpi: { venta, costo, ganancia, margen_pct: venta ? r2((ganancia / venta) * 100) : 0, descuento: r2(kpi.descuento) },
    serie: serie.map((s) => {
      const v = r2(s.venta); const c = r2(s.costo); const g = r2(v - c);
      return { periodo: s.periodo, venta: v, costo: c, ganancia: g, margen_pct: v ? r2((g / v) * 100) : 0 };
    }),
    nota: NOTA_GANANCIA,
  };
}

async function gananciasPorProducto(empresaId, filtros) {
  const periodo = resolverRango(filtros);
  const sucursalId = filtros.sucursal_id || null;
  const { where, params } = condVentas({ empresaId, ...periodo, sucursalId });
  const costoSub = subconsultaCosto(periodo);
  const limit = clampInt(filtros.limit, 30, 1, 100);

  const [rows] = await pool.query(
    `SELECT ppa.producto_id, MAX(ppa.descripcion) AS descripcion, SUM(ppa.cantidad) AS cantidad,
            COALESCE(SUM(ppa.importe),0) AS venta, COALESCE(SUM(costo.costo),0) AS costo,
            COALESCE(SUM(ppa.descuento),0) AS descuento
     FROM pos_ventas v
     JOIN (${SQL_PARTIDAS_AGRUPADAS}) ppa ON ppa.venta_id = v.id
     LEFT JOIN (${costoSub.sql}) costo ON costo.folio = v.folio COLLATE utf8mb4_general_ci AND costo.producto_id = ppa.producto_id
     WHERE ${where}
     GROUP BY ppa.producto_id
     ORDER BY venta DESC LIMIT ${limit}`,
    [...costoSub.params, ...params]
  );
  const items = rows.map((r) => {
    const venta = r2(r.venta); const costo = r2(r.costo); const ganancia = r2(venta - costo);
    return {
      producto_id: r.producto_id, descripcion: r.descripcion, cantidad: Number(r.cantidad),
      venta, costo, ganancia, margen_pct: venta ? r2((ganancia / venta) * 100) : 0, descuento: r2(r.descuento),
    };
  });
  return {
    ...(await meta(empresaId, periodo, 'Ganancia por producto', { reporte: 'ganancias_productos' })),
    rows: items,
    top_rentables: [...items].sort((a, b) => b.ganancia - a.ganancia).slice(0, 10),
    top_vendidos: [...items].sort((a, b) => b.cantidad - a.cantidad).slice(0, 10),
    nota: NOTA_GANANCIA,
  };
}

// Bitácora de precios modificados en el mostrador (migrate_v45): el cajero
// puede cobrar distinto al precio de catálogo por cualquier situación, sin
// autorización de supervisor (ver pos.ventas.service.js#crearVenta), pero el
// backend exige motivo y lo snapshotea en la partida — este reporte es,
// literalmente, listar las partidas con motivo_cambio_precio no nulo. Mismo
// permiso que ganancias/márgenes: información sensible que el admin decide
// si comparte con operadores.
async function preciosModificados(empresaId, filtros) {
  const periodo = resolverRango(filtros);
  const sucursalId = filtros.sucursal_id || null;
  const { where, params } = condVentas({ empresaId, ...periodo, sucursalId });
  const limit = clampInt(filtros.limit, 100, 1, 500);

  const [rows] = await pool.query(
    `SELECT v.folio, v.created_at, s.nombre AS sucursal, u.nombre AS cajero,
            pp.descripcion, pp.precio_original, pp.precio_unitario, pp.cantidad,
            pp.motivo_cambio_precio
     FROM pos_ventas_partidas pp
     JOIN pos_ventas v ON v.id = pp.venta_id
     JOIN sucursales s ON s.id = v.sucursal_id
     JOIN usuarios u ON u.id = v.usuario_id
     WHERE ${where} AND pp.motivo_cambio_precio IS NOT NULL
     ORDER BY v.created_at DESC LIMIT ${limit}`,
    params
  );
  return {
    ...(await meta(empresaId, periodo, 'Precios modificados en el mostrador', { reporte: 'precios_modificados' })),
    rows: rows.map((r) => ({
      folio: r.folio,
      created_at: r.created_at,
      sucursal: r.sucursal,
      cajero: r.cajero,
      descripcion: r.descripcion,
      cantidad: Number(r.cantidad),
      precio_lista: r2(r.precio_original),
      precio_cobrado: r2(r.precio_unitario),
      diferencia: r2(r.precio_unitario - r.precio_original),
      motivo: r.motivo_cambio_precio,
    })),
    nota: 'Ventas donde el cajero capturó un precio distinto al de catálogo, con el motivo que registró en el momento.',
  };
}

module.exports = {
  resumenVentas, ventasPorSucursal, topProductos, ventasDetalladoProducto, formasPago, existencias, recetasCofepris,
  tickets, ganancias, gananciasPorProducto, preciosModificados,
};
