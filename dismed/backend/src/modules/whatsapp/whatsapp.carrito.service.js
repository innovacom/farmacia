/**
 * whatsapp.carrito.service.js — Carrito conversacional de WhatsApp y pedido
 * en firme, sin pasar por solicitud/cotización/comparador (ver
 * migrate_v50.js). Máquina de estados simple, guiada por `whatsapp_carritos.paso`:
 *
 *   carrito -> esperando_cantidad (producto ya resuelto, falta cuántos)
 *   carrito -> esperando_entrega -> esperando_direccion (si domicilio)
 *           -> esperando_nombre -> esperando_pago -> esperando_confirmacion
 *
 * Cada función de "paso" (elegirEntrega, elegirPago, confirmarPedidoFinal…)
 * se puede alcanzar por BOTÓN (manejarBoton, ids con prefijo WA_) o por
 * TEXTO libre (manejarPasoPendiente, con reconocimiento simple de palabras
 * clave/números — no usa IA aquí, ya se resolvió qué paso toca).
 *
 * La entrada a este flujo desde texto SIN un paso pendiente sí pasa por IA
 * (manejarIntencionIA, llamado desde whatsapp.chatbot.service#generarRespuesta
 * cuando el clasificador detecta agregar_producto/ver_carrito/etc.).
 *
 * Inventario: se descuenta con registrarSalidaFEFO AL CONFIRMAR el pedido
 * (mismo momento que una venta de mostrador) — no antes. Si el pedido se
 * cancela después (no pagó, receta inválida), se reingresa por lote exacto
 * usando `lotes_json` de cada partida (ver whatsapp.pedidos.controller#cancelar,
 * mismo patrón que pos.ventas.service#cancelarVenta).
 */
const { pool } = require('../../config/db');
const ventas = require('../pos/pos.ventas.service');
const promociones = require('../pos/pos.promociones.service');
const inv = require('../inventario/movimientos.service');

// Misma lista que pos.ventas.service#CLASIF_LIBRES — si un producto NO está
// en esta lista, su venta exige receta médica (aquí: FOTO por WhatsApp).
const CLASIF_LIBRES = ['libre', 'venta_farmacia'];

const PAGO_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' };

// Los 3 botones de siempre sobre el carrito con productos ya cargados
// (resumen simple, sin haber entrado al wizard de entrega/pago).
const BOTONES_CARRITO_BASE = [
  { id: 'WA_QUITARMENU', titulo: 'Quitar producto' },
  { id: 'WA_CONFIRMAR', titulo: 'Confirmar pedido' },
  { id: 'WA_CANCELARCARRITO', titulo: 'Cancelar pedido' },
];

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

async function resolverSucursal(empresaId) {
  const [[suc]] = await pool.query(
    `SELECT id, almacen_id, nombre FROM sucursales WHERE empresa_id = ? AND activo = 1 ORDER BY id LIMIT 1`,
    [empresaId]
  );
  return suc || null;
}

async function obtenerCarritoAbierto(empresaId, contactoId) {
  const [[row]] = await pool.query(
    `SELECT * FROM whatsapp_carritos WHERE empresa_id = ? AND contacto_id = ? AND estatus = 'abierto' ORDER BY id DESC LIMIT 1`,
    [empresaId, contactoId]
  );
  return row || null;
}

async function obtenerOCrearCarrito(empresaId, contactoId) {
  const existente = await obtenerCarritoAbierto(empresaId, contactoId);
  if (existente) return existente;
  const suc = await resolverSucursal(empresaId);
  if (!suc) return null;
  const [r] = await pool.query(
    `INSERT INTO whatsapp_carritos (empresa_id, contacto_id, sucursal_id) VALUES (?, ?, ?)`,
    [empresaId, contactoId, suc.id]
  );
  return {
    id: r.insertId, empresa_id: empresaId, contacto_id: contactoId, sucursal_id: suc.id,
    estatus: 'abierto', paso: 'carrito', pendiente_producto_id: null, pendiente_presentacion_id: null,
    forma_entrega: null, direccion_entrega: null, nombre_recibe: null, forma_pago: null, pedido_id: null,
  };
}

async function itemsDelCarrito(carritoId) {
  const [rows] = await pool.query('SELECT * FROM whatsapp_carrito_items WHERE carrito_id = ? ORDER BY id', [carritoId]);
  return rows;
}

function textoResumenItems(items) {
  const lineas = items.map((it) => `• ${Number(it.cantidad)} x ${it.descripcion} — ${money(it.cantidad * it.precio_unitario)}`);
  const total = items.reduce((a, it) => a + Number(it.cantidad) * Number(it.precio_unitario), 0);
  return `Tu pedido:\n${lineas.join('\n')}\n\nTotal: ${money(total)}`;
}

// Resuelve un producto/presentación exacto (por id) con precio y existencia
// AL MOMENTO, incluyendo promoción vigente — mismo criterio que
// pos.ventas.service#buscarProductos, pero por id en vez de texto (se usa
// cuando el cliente ya eligió de una lista y solo falta la cantidad).
async function resolverProductoParaCarrito(empresaId, sucursalId, productoId, presentacionId) {
  const conn = await pool.getConnection();
  try {
    const [[suc]] = await conn.query('SELECT almacen_id FROM sucursales WHERE id = ? AND empresa_id = ?', [sucursalId, empresaId]);
    if (!suc) return null;
    let row;
    if (presentacionId) {
      const [[r]] = await conn.query(
        `SELECT p.id AS producto_id, pp.id AS presentacion_id,
                CONCAT(p.descripcion, ' - ', pp.nombre) AS descripcion,
                COALESCE(pp.precio_lista, p.precio_lista * pp.factor_conversion) AS precio_lista,
                p.clasificacion_cofepris,
                COALESCE((SELECT SUM(l.cantidad_actual) FROM inventario_lotes l WHERE l.producto_id = p.id AND l.almacen_id = ?), 0) AS existencia
         FROM producto_presentaciones pp JOIN productos p ON p.id = pp.producto_id
         WHERE pp.id = ? AND pp.producto_id = ? AND p.activo = 1 AND p.vendible = 1 AND pp.activo_pos = 1`,
        [suc.almacen_id, presentacionId, productoId]
      );
      row = r;
    } else {
      const [[r]] = await conn.query(
        `SELECT p.id AS producto_id, NULL AS presentacion_id, p.descripcion,
                p.precio_lista, p.clasificacion_cofepris,
                COALESCE((SELECT SUM(l.cantidad_actual) FROM inventario_lotes l WHERE l.producto_id = p.id AND l.almacen_id = ?), 0) AS existencia
         FROM productos p WHERE p.id = ? AND p.activo = 1 AND p.vendible = 1`,
        [suc.almacen_id, productoId]
      );
      row = r;
    }
    if (!row) return null;
    const promos = await promociones.descuentosPara(conn, empresaId, [row.producto_id]);
    const promo = promos.get(row.producto_id);
    const precio_final = promo
      ? Math.round(Number(row.precio_lista) * (1 - promo.pct / 100) * 100) / 100
      : Number(row.precio_lista);
    return { ...row, precio_final };
  } finally {
    conn.release();
  }
}

// Suma (o inserta) el producto en el carrito. `producto` puede venir de
// ventas.buscarProductos (trae precio_final ya con promo) o de
// resolverProductoParaCarrito (misma forma).
async function agregarItemCarrito(carrito, producto, cantidad) {
  const requiereReceta = CLASIF_LIBRES.includes(producto.clasificacion_cofepris) ? 0 : 1;
  const [[existente]] = await pool.query(
    `SELECT id, cantidad FROM whatsapp_carrito_items
     WHERE carrito_id = ? AND producto_id = ? AND presentacion_id <=> ?`,
    [carrito.id, producto.producto_id, producto.presentacion_id || null]
  );
  let cantidadTotal = cantidad;
  if (existente) {
    cantidadTotal = Number(existente.cantidad) + cantidad;
    await pool.query('UPDATE whatsapp_carrito_items SET cantidad = ?, precio_unitario = ? WHERE id = ?',
      [cantidadTotal, producto.precio_final, existente.id]);
  } else {
    await pool.query(
      `INSERT INTO whatsapp_carrito_items (carrito_id, producto_id, presentacion_id, descripcion, cantidad, precio_unitario, requiere_receta)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [carrito.id, producto.producto_id, producto.presentacion_id || null, producto.descripcion, cantidad, producto.precio_final, requiereReceta]
    );
  }
  return {
    descripcion: producto.descripcion, cantidadAgregada: cantidad, cantidadTotal,
    precio_unitario: producto.precio_final, existencia: producto.existencia,
  };
}

function respuestaTrasAgregar(item) {
  const avisoStock = (item.existencia != null && Number(item.existencia) < item.cantidadTotal)
    ? `\n⚠️ Por el momento solo tenemos ${item.existencia} en existencia; lo confirmamos antes de entregar.`
    : '';
  return {
    texto: `Agregado: ${item.cantidadAgregada} x ${item.descripcion} (${money(item.precio_unitario)} c/u).${avisoStock}\n\n¿Algo más?`,
    botones: [
      { id: 'WA_VERCARRITO', titulo: 'Ver carrito' },
      { id: 'WA_QUITARMENU', titulo: 'Quitar producto' },
      { id: 'WA_CONFIRMAR', titulo: 'Confirmar pedido' },
    ],
  };
}

// Prompt/botones del paso actual del wizard, para "retomar donde iba" tras
// una interrupción (p.ej. quitar un producto a medio wizard) sin perder lo
// ya capturado (entrega/dirección/nombre/pago). El paso 'carrito' usa el
// resumen simple con las 3 acciones de siempre.
async function promptParaPaso(carrito, itemsPrecargados) {
  const cancelBtn = { id: 'WA_CANCELARCARRITO', titulo: 'Cancelar pedido' };
  if (carrito.paso === 'esperando_entrega') {
    return {
      texto: '¿Cómo lo quieres recibir?',
      botones: [
        { id: 'WA_ENTREGA:pickup', titulo: 'Recoger en tienda' },
        { id: 'WA_ENTREGA:domicilio', titulo: 'A domicilio' },
        cancelBtn,
      ],
    };
  }
  if (carrito.paso === 'esperando_direccion') {
    return { texto: 'Escríbeme la dirección completa (calle, número, colonia y alguna referencia).', botones: [cancelBtn] };
  }
  if (carrito.paso === 'esperando_nombre') {
    return { texto: '¿A nombre de quién es el pedido?', botones: [cancelBtn] };
  }
  if (carrito.paso === 'esperando_pago') {
    return promptPago();
  }
  if (carrito.paso === 'esperando_confirmacion') {
    return await textoRevisionFinal(carrito, itemsPrecargados);
  }
  const items = itemsPrecargados || await itemsDelCarrito(carrito.id);
  return { texto: textoResumenItems(items), botones: BOTONES_CARRITO_BASE };
}

// Lista interactiva "¿cómo vas a pagar?" — se ofrece tanto al llegar por
// primera vez a este paso (promptParaPaso) como al terminar de capturar el
// nombre por texto libre (manejarPasoPendiente#esperando_nombre).
function promptPago() {
  return {
    texto: 'Se cobra al momento de la entrega. ¿Cómo vas a pagar?',
    lista: {
      botonMenu: 'Elegir',
      filas: [
        { id: 'WA_PAGO:efectivo', titulo: 'Efectivo' },
        { id: 'WA_PAGO:transferencia', titulo: 'Transferencia' },
        { id: 'WA_PAGO:tarjeta', titulo: 'Tarjeta' },
        { id: 'WA_CANCELARCARRITO', titulo: 'Cancelar pedido' },
      ],
    },
  };
}

// Texto de revisión final (entrega + nombre + pago + total) con los botones
// Confirmar/Quitar/Cancelar — usado tanto al llegar por primera vez a este
// paso (elegirPago) como al retomarlo tras quitar un producto.
async function textoRevisionFinal(carrito, itemsPrecargados) {
  const items = itemsPrecargados || await itemsDelCarrito(carrito.id);
  const entregaTxt = carrito.forma_entrega === 'domicilio'
    ? `Entrega a domicilio: ${carrito.direccion_entrega}`
    : 'Recoges en tienda';
  return {
    texto: `${textoResumenItems(items)}\n\n${entregaTxt}\nA nombre de: ${carrito.nombre_recibe}\nPago: ${PAGO_LABEL[carrito.forma_pago] || carrito.forma_pago} al momento de la entrega\n\n¿Confirmamos tu pedido?`,
    botones: [
      { id: 'WA_CONFIRMARFINAL', titulo: 'Confirmar pedido' },
      { id: 'WA_QUITARMENU', titulo: 'Quitar producto' },
      { id: 'WA_CANCELARFINAL', titulo: 'Cancelar' },
    ],
  };
}

// Tras borrar un producto del carrito: si quedó vacío no tiene sentido
// seguir el wizard de entrega/pago, así que se cancela solo; si no, se
// retoma exactamente el paso donde iba el cliente (sin reiniciar el wizard).
async function despuesDeQuitar(carrito, descripcionQuitada) {
  const items = await itemsDelCarrito(carrito.id);
  const prefijo = `Quité "${descripcionQuitada}" de tu pedido.`;
  if (!items.length) {
    await pool.query(`UPDATE whatsapp_carritos SET estatus = 'cancelado' WHERE id = ?`, [carrito.id]);
    return { texto: `${prefijo} Tu pedido quedó vacío, así que lo cancelé. Cuando quieras, dime qué producto buscas para empezar de nuevo.` };
  }
  const siguiente = await promptParaPaso(carrito, items);
  return { texto: `${prefijo}\n\n${siguiente.texto}`, botones: siguiente.botones, lista: siguiente.lista };
}

// Abre/recupera el carrito (para tener sucursal_id) y busca el producto en
// catálogo — prólogo compartido por mostrarProductoConOpcionAgregar (solo
// informativo) y flujoAgregar (que además agrega/pide cantidad). Devuelve
// `{ error }` con el texto a responder si no hay sucursal o no hubo match.
async function resolverCarritoYBuscar(empresaId, contacto, texto) {
  const carrito = await obtenerOCrearCarrito(empresaId, contacto.id);
  if (!carrito) return { error: { texto: 'Por el momento no tengo esa información. Un asesor te contestará en breve.' } };

  const resultados = await ventas.buscarProductos(empresaId, { q: texto, sucursal_id: carrito.sucursal_id });
  if (!resultados.length) {
    return { error: { texto: `No encontré "${texto}" en el catálogo. ¿Me confirmas el nombre exacto o si tiene otra presentación?` } };
  }
  return { carrito, resultados };
}

// ── Flujos disparados por intención de IA (mensaje libre, sin paso pendiente) ──

// Pregunta SOLO informativa ("¿tienen paracetamol?", "cuánto cuesta X") —
// a diferencia de flujoAgregar, nunca agrega nada ni pide cantidad de una:
// siempre muestra el precio/existencia (como antes) y además ofrece un
// botón/lista para pedirlo, tocando el mismo WA_ELEGIR que usa la
// desambiguación de flujoAgregar (que ya deja el carrito en
// 'esperando_cantidad' al tocarlo). Abre el carrito (vacío) igual que
// flujoAgregar, solo para tener sucursal_id resuelto — no tiene efecto si el
// cliente nunca confirma nada.
async function mostrarProductoConOpcionAgregar(empresaId, contacto, query) {
  const texto = (query || '').trim();
  if (!texto) return { texto: 'Cuéntame qué producto buscas y con gusto te digo si lo tenemos y el precio.' };

  const { error, resultados } = await resolverCarritoYBuscar(empresaId, contacto, texto);
  if (error) return error;

  const top = resultados.slice(0, 10);
  const lineas = top.map((r) => `• ${r.descripcion}: ${money(r.precio_final)}${r.existencia > 0 ? ', sí tenemos existencia' : ', por el momento sin existencia'}`);
  const textoBase = `${lineas.join('\n')}\n\n¿Quieres pedir alguno?`;

  if (top.length === 1) {
    const r = top[0];
    return { texto: textoBase, botones: [{ id: `WA_ELEGIR:${r.producto_id}:${r.presentacion_id || 0}`, titulo: 'Seleccionar y pedir' }] };
  }
  return {
    texto: textoBase,
    lista: {
      botonMenu: 'Seleccionar y pedir',
      filas: top.map((r) => ({
        id: `WA_ELEGIR:${r.producto_id}:${r.presentacion_id || 0}`,
        titulo: r.descripcion,
        descripcion: `${money(r.precio_final)}${r.existencia > 0 ? '' : ' — sin existencia'}`,
      })),
    },
  };
}

async function flujoAgregar(empresaId, contacto, query, cantidad) {
  const texto = (query || '').trim();
  if (!texto) return { texto: 'Cuéntame qué producto quieres agregar a tu pedido.' };

  const { error, carrito, resultados } = await resolverCarritoYBuscar(empresaId, contacto, texto);
  if (error) return error;

  if (resultados.length > 1) {
    const filas = resultados.slice(0, 10).map((r) => ({
      id: `WA_ELEGIR:${r.producto_id}:${r.presentacion_id || 0}`,
      titulo: r.descripcion,
      descripcion: `${money(r.precio_final)}${r.existencia > 0 ? '' : ' — sin existencia'}`,
    }));
    return { texto: `Encontré varias opciones para "${texto}". ¿Cuál quieres?`, lista: { botonMenu: 'Elegir', filas } };
  }

  const producto = resultados[0];
  const cantidadNum = Number(cantidad);
  if (cantidadNum > 0) {
    const item = await agregarItemCarrito(carrito, producto, cantidadNum);
    return respuestaTrasAgregar(item);
  }

  await pool.query(
    `UPDATE whatsapp_carritos SET paso = 'esperando_cantidad', pendiente_producto_id = ?, pendiente_presentacion_id = ? WHERE id = ?`,
    [producto.producto_id, producto.presentacion_id || null, carrito.id]
  );
  const avisoStock = producto.existencia > 0 ? '' : ' — por el momento sin existencia';
  return { texto: `¿Cuántas unidades de ${producto.descripcion} quieres? (${money(producto.precio_final)} c/u${avisoStock})` };
}

async function flujoVerCarrito(empresaId, contacto) {
  const carrito = await obtenerCarritoAbierto(empresaId, contacto.id);
  if (!carrito) return { texto: 'Aún no tienes nada en tu pedido. Dime qué producto quieres.' };
  const items = await itemsDelCarrito(carrito.id);
  if (!items.length) return { texto: 'Tu carrito está vacío. Dime qué producto quieres agregar.' };
  return { texto: textoResumenItems(items), botones: BOTONES_CARRITO_BASE };
}

async function flujoQuitar(empresaId, contacto, query) {
  const carrito = await obtenerCarritoAbierto(empresaId, contacto.id);
  if (!carrito) return { texto: 'No tienes ningún pedido en curso.' };
  const items = await itemsDelCarrito(carrito.id);
  if (!items.length) return { texto: 'Tu carrito ya está vacío.' };

  const texto = (query || '').trim().toLowerCase();
  if (!texto) {
    return {
      texto: '¿Cuál producto quieres quitar?',
      lista: { botonMenu: 'Quitar', filas: items.map((it) => ({ id: `WA_QUITAR:${it.id}`, titulo: it.descripcion, descripcion: `${Number(it.cantidad)} x ${money(it.precio_unitario)}` })) },
    };
  }
  const candidatos = items.filter((it) => it.descripcion.toLowerCase().includes(texto));
  if (candidatos.length === 1) {
    await pool.query('DELETE FROM whatsapp_carrito_items WHERE id = ?', [candidatos[0].id]);
    return await despuesDeQuitar(carrito, candidatos[0].descripcion);
  }
  if (candidatos.length > 1) {
    return {
      texto: `Encontré varios que coinciden con "${query}". ¿Cuál quitamos?`,
      lista: { botonMenu: 'Quitar', filas: candidatos.map((it) => ({ id: `WA_QUITAR:${it.id}`, titulo: it.descripcion, descripcion: `${Number(it.cantidad)} x ${money(it.precio_unitario)}` })) },
    };
  }
  return { texto: `No encontré "${query}" en tu pedido.\n\n${textoResumenItems(items)}` };
}

async function flujoIniciarConfirmacion(empresaId, contacto) {
  const carrito = await obtenerCarritoAbierto(empresaId, contacto.id);
  if (!carrito) return { texto: 'Aún no tienes nada en tu pedido. Dime qué producto quieres.' };
  const items = await itemsDelCarrito(carrito.id);
  if (!items.length) return { texto: 'Tu carrito está vacío. Dime qué producto quieres agregar primero.' };
  await pool.query(`UPDATE whatsapp_carritos SET paso = 'esperando_entrega' WHERE id = ?`, [carrito.id]);
  return {
    texto: `${textoResumenItems(items)}\n\n¿Cómo lo quieres recibir?`,
    botones: [
      { id: 'WA_ENTREGA:pickup', titulo: 'Recoger en tienda' },
      { id: 'WA_ENTREGA:domicilio', titulo: 'A domicilio' },
      { id: 'WA_CANCELARCARRITO', titulo: 'Cancelar pedido' },
    ],
  };
}

async function flujoCancelarCarrito(empresaId, contacto) {
  const carrito = await obtenerCarritoAbierto(empresaId, contacto.id);
  if (!carrito) return { texto: 'No tienes ningún pedido en curso.' };
  await pool.query(`UPDATE whatsapp_carritos SET estatus = 'cancelado' WHERE id = ?`, [carrito.id]);
  return { texto: 'Tu pedido fue cancelado. Cuando quieras, empezamos de nuevo — solo dime qué producto buscas.' };
}

// Punto de entrada desde el clasificador de IA (whatsapp.chatbot.service).
// Solo se llama cuando NO había un paso pendiente que ya haya resuelto el
// mensaje (ver manejarPasoPendiente) — o sea, es siempre el mensaje que
// ABRE o retoma el flujo de carrito en frío.
async function manejarIntencionIA(empresaId, contacto, intent, { producto_query, cantidad } = {}) {
  switch (intent) {
    case 'agregar_producto': return await flujoAgregar(empresaId, contacto, producto_query, cantidad);
    case 'ver_carrito': return await flujoVerCarrito(empresaId, contacto);
    case 'quitar_producto': return await flujoQuitar(empresaId, contacto, producto_query);
    case 'confirmar_pedido': return await flujoIniciarConfirmacion(empresaId, contacto);
    case 'cancelar_pedido': return await flujoCancelarCarrito(empresaId, contacto);
    default: return null;
  }
}

// ── Pasos guiados (botón o texto libre ya interpretado) ──

async function elegirEntrega(empresaId, contacto, carrito, valor) {
  if (!carrito || carrito.paso !== 'esperando_entrega') return null;
  const cancelBtn = { id: 'WA_CANCELARCARRITO', titulo: 'Cancelar pedido' };
  if (valor === 'pickup') {
    await pool.query(`UPDATE whatsapp_carritos SET forma_entrega = 'pickup', direccion_entrega = NULL, paso = 'esperando_nombre' WHERE id = ?`, [carrito.id]);
    return { texto: '¿A nombre de quién dejamos el pedido para recoger?', botones: [cancelBtn] };
  }
  if (valor === 'domicilio') {
    await pool.query(`UPDATE whatsapp_carritos SET forma_entrega = 'domicilio', paso = 'esperando_direccion' WHERE id = ?`, [carrito.id]);
    return { texto: 'Perfecto, escríbeme la dirección completa (calle, número, colonia y alguna referencia).', botones: [cancelBtn] };
  }
  return null;
}

async function elegirPago(empresaId, contacto, carrito, valor) {
  if (!carrito || carrito.paso !== 'esperando_pago') return null;
  await pool.query(`UPDATE whatsapp_carritos SET forma_pago = ?, paso = 'esperando_confirmacion' WHERE id = ?`, [valor, carrito.id]);
  return await textoRevisionFinal({ ...carrito, forma_pago: valor });
}

// Cierra el carrito y crea el pedido en firme: descuenta inventario por FEFO
// (mismo mecanismo que una venta de mostrador) y, si algún producto requiere
// receta, deja el pedido en receta_estatus='pendiente' pidiendo la foto.
async function confirmarPedidoFinal(empresaId, contacto, carrito) {
  if (!carrito || carrito.paso !== 'esperando_confirmacion') {
    return { texto: 'No hay ningún pedido pendiente de confirmar en este momento.' };
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [items] = await conn.query('SELECT * FROM whatsapp_carrito_items WHERE carrito_id = ? FOR UPDATE', [carrito.id]);
    if (!items.length) { await conn.rollback(); return { texto: 'Tu carrito está vacío.' }; }
    const [[suc]] = await conn.query('SELECT id, almacen_id FROM sucursales WHERE id = ? AND empresa_id = ?', [carrito.sucursal_id, empresaId]);
    if (!suc) { await conn.rollback(); return { texto: 'Hubo un problema con la sucursal; contáctanos directamente.' }; }

    const productoIds = [...new Set(items.map((it) => it.producto_id))];
    const [prodRows] = await conn.query('SELECT id, iva_exento FROM productos WHERE id IN (?)', [productoIds]);
    const ivaExentoPorProducto = new Map(prodRows.map((p) => [p.id, p.iva_exento]));

    let subtotal = 0; let iva = 0; let requiereRecetaPedido = false;
    const partidasProcesadas = [];
    for (const it of items) {
      const ivaTasa = ivaExentoPorProducto.get(it.producto_id) ? 0 : 0.16;
      const importe = Math.round(Number(it.cantidad) * Number(it.precio_unitario) * 100) / 100;
      const importeSinIva = Math.round((importe / (1 + ivaTasa)) * 100) / 100;
      subtotal += importeSinIva;
      iva += importe - importeSinIva;
      if (it.requiere_receta) requiereRecetaPedido = true;

      let salida;
      try {
        salida = await inv.registrarSalidaFEFO(conn, {
          producto_id: it.producto_id, cantidad: it.cantidad, motivo: 'pedido_whatsapp',
          referencia: null, usuario_id: null, almacen_id: suc.almacen_id,
        });
      } catch (e) {
        await conn.rollback();
        return { texto: `Lo siento, ya no tenemos suficiente existencia de "${it.descripcion}" (disponible: ${e.disponible ?? 0}). Escríbeme "quitar ${it.descripcion}" o ajusta la cantidad y vuelve a confirmar.` };
      }
      partidasProcesadas.push({ ...it, ivaTasa, importe, lotes: salida.lotes });
    }
    subtotal = Math.round(subtotal * 100) / 100;
    iva = Math.round(iva * 100) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;

    const folio = await inv.genFolio(conn, 'PWA');
    const [rp] = await conn.query(
      `INSERT INTO pedidos_whatsapp
         (empresa_id, folio, contacto_id, carrito_id, sucursal_id, nombre_recibe, telefono,
          forma_entrega, direccion_entrega, forma_pago, receta_estatus, subtotal, iva, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, folio, contacto.id, carrito.id, suc.id, carrito.nombre_recibe, contacto.telefono,
       carrito.forma_entrega, carrito.direccion_entrega, carrito.forma_pago,
       requiereRecetaPedido ? 'pendiente' : 'no_aplica', subtotal, iva, total]
    );
    const pedidoId = rp.insertId;

    for (const p of partidasProcesadas) {
      await conn.query(
        `INSERT INTO pedidos_whatsapp_partidas
           (pedido_id, producto_id, presentacion_id, descripcion, cantidad, precio_unitario, iva_tasa, importe, requiere_receta, lotes_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pedidoId, p.producto_id, p.presentacion_id, p.descripcion, p.cantidad, p.precio_unitario, p.ivaTasa, p.importe, p.requiere_receta, JSON.stringify(p.lotes)]
      );
    }
    await conn.query(`UPDATE whatsapp_carritos SET estatus = 'confirmado', pedido_id = ? WHERE id = ?`, [pedidoId, carrito.id]);
    await conn.commit();

    let texto = `¡Listo! Tu pedido ${folio} quedó registrado. Total: ${money(total)}, pago ${carrito.forma_pago} al momento de la entrega.`;
    if (requiereRecetaPedido) {
      texto += '\n\nUno o más productos requieren receta médica. Por favor mándame una FOTO de tu receta para poder surtir tu pedido.';
    }
    return { texto };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── Mensajes de botón (interactive button_reply / list_reply), prefijo WA_ ──
// Devuelve null si el id no es nuestro (deja que el llamador siga con la
// lógica de citas u otra cosa).
async function manejarBoton(empresaId, contacto, idBoton) {
  if (!idBoton || !idBoton.startsWith('WA_')) return null;
  const partes = idBoton.split(':');
  const cmd = partes[0];
  const carrito = await obtenerCarritoAbierto(empresaId, contacto.id);

  switch (cmd) {
    case 'WA_ELEGIR': {
      // Puede llegar sin carrito abierto (el cliente solo había preguntado
      // el precio, ver mostrarProductoConOpcionAgregar) — se crea aquí mismo.
      const carritoDestino = carrito || await obtenerOCrearCarrito(empresaId, contacto.id);
      if (!carritoDestino) return { texto: 'Por el momento no tengo esa información. Un asesor te contestará en breve.' };
      const productoId = Number(partes[1]);
      const presentacionId = Number(partes[2]) || null;
      await pool.query(
        `UPDATE whatsapp_carritos SET paso = 'esperando_cantidad', pendiente_producto_id = ?, pendiente_presentacion_id = ? WHERE id = ?`,
        [productoId, presentacionId, carritoDestino.id]
      );
      return { texto: '¿Cuántas unidades quieres?' };
    }
    case 'WA_QUITAR': {
      if (!carrito) return { texto: 'Tu pedido ya no está activo.' };
      const itemId = Number(partes[1]);
      const [[item]] = await pool.query('SELECT descripcion FROM whatsapp_carrito_items WHERE id = ? AND carrito_id = ?', [itemId, carrito.id]);
      if (!item) return { texto: 'Ese producto ya no está en tu pedido.' };
      await pool.query('DELETE FROM whatsapp_carrito_items WHERE id = ? AND carrito_id = ?', [itemId, carrito.id]);
      return await despuesDeQuitar(carrito, item.descripcion);
    }
    case 'WA_QUITARMENU':
      return await flujoQuitar(empresaId, contacto, '');
    case 'WA_SEGUIR':
      return { texto: 'Perfecto, dime qué otro producto quieres.' };
    case 'WA_VERCARRITO':
      return await flujoVerCarrito(empresaId, contacto);
    case 'WA_CONFIRMAR':
      return await flujoIniciarConfirmacion(empresaId, contacto);
    case 'WA_CANCELARCARRITO':
    case 'WA_CANCELARFINAL':
      return await flujoCancelarCarrito(empresaId, contacto);
    case 'WA_ENTREGA':
      return await elegirEntrega(empresaId, contacto, carrito, partes[1]);
    case 'WA_PAGO':
      return await elegirPago(empresaId, contacto, carrito, partes[1]);
    case 'WA_CONFIRMARFINAL':
      return await confirmarPedidoFinal(empresaId, contacto, carrito);
    default:
      return null;
  }
}

// ── Mensaje de TEXTO libre mientras hay un paso pendiente (sin IA) ──
// Devuelve { manejado: false } si no hay carrito abierto o el paso actual
// solo se resuelve por botón y el texto no matcheó ninguna palabra clave
// reconocida (se le pide de nuevo usar los botones, pero SIGUE manejado).
async function manejarPasoPendiente(empresaId, contacto, texto) {
  const carrito = await obtenerCarritoAbierto(empresaId, contacto.id);
  if (!carrito || carrito.paso === 'carrito') return { manejado: false };
  const t = (texto || '').trim();
  const tl = t.toLowerCase();

  // Escape hatches disponibles en cualquier paso del wizard de entrega/pago:
  // cancelar todo el pedido o quitar un producto, sin tener que terminar el
  // wizard primero. No aplica en esperando_cantidad (se espera un número) ni
  // en esperando_confirmacion (tiene su propio manejo de sí/no/quitar abajo,
  // por la ambigüedad de "no").
  if (carrito.paso !== 'esperando_cantidad' && carrito.paso !== 'esperando_confirmacion') {
    if (/cancelar/.test(tl)) return { manejado: true, respuesta: await flujoCancelarCarrito(empresaId, contacto) };
    if (/quitar|eliminar/.test(tl)) return { manejado: true, respuesta: await flujoQuitar(empresaId, contacto, '') };
  }

  if (carrito.paso === 'esperando_cantidad') {
    const m = t.match(/\d+(\.\d+)?/);
    if (!m) return { manejado: true, respuesta: { texto: 'No entendí la cantidad. Dime solo el número, por ejemplo: 3' } };
    const cantidad = parseFloat(m[0]);
    if (!(cantidad > 0)) return { manejado: true, respuesta: { texto: 'La cantidad debe ser mayor a 0.' } };
    const producto = await resolverProductoParaCarrito(empresaId, carrito.sucursal_id, carrito.pendiente_producto_id, carrito.pendiente_presentacion_id);
    await pool.query(`UPDATE whatsapp_carritos SET paso = 'carrito', pendiente_producto_id = NULL, pendiente_presentacion_id = NULL WHERE id = ?`, [carrito.id]);
    if (!producto) return { manejado: true, respuesta: { texto: 'Ese producto ya no está disponible, intenta con otro.' } };
    const item = await agregarItemCarrito(carrito, producto, cantidad);
    return { manejado: true, respuesta: respuestaTrasAgregar(item) };
  }

  if (carrito.paso === 'esperando_entrega') {
    if (/domicilio|casa|env[íi]o/.test(tl)) return { manejado: true, respuesta: await elegirEntrega(empresaId, contacto, carrito, 'domicilio') };
    if (/recoger|tienda|mostrador|pickup/.test(tl)) return { manejado: true, respuesta: await elegirEntrega(empresaId, contacto, carrito, 'pickup') };
    return { manejado: true, respuesta: { texto: 'Por favor elige una opción: Recoger en tienda o A domicilio.' } };
  }

  if (carrito.paso === 'esperando_direccion') {
    if (t.length < 5) return { manejado: true, respuesta: { texto: 'Necesito la dirección completa (calle, número, colonia).', botones: [{ id: 'WA_CANCELARCARRITO', titulo: 'Cancelar pedido' }] } };
    await pool.query(`UPDATE whatsapp_carritos SET direccion_entrega = ?, paso = 'esperando_nombre' WHERE id = ?`, [t.slice(0, 500), carrito.id]);
    return { manejado: true, respuesta: { texto: '¿A nombre de quién es el pedido?', botones: [{ id: 'WA_CANCELARCARRITO', titulo: 'Cancelar pedido' }] } };
  }

  if (carrito.paso === 'esperando_nombre') {
    if (!t) return { manejado: true, respuesta: { texto: 'Dime el nombre de quien recibe el pedido.', botones: [{ id: 'WA_CANCELARCARRITO', titulo: 'Cancelar pedido' }] } };
    await pool.query(`UPDATE whatsapp_carritos SET nombre_recibe = ?, paso = 'esperando_pago' WHERE id = ?`, [t.slice(0, 150), carrito.id]);
    return { manejado: true, respuesta: promptPago() };
  }

  if (carrito.paso === 'esperando_pago') {
    const mapa = { efectivo: /efectivo/, transferencia: /transf/, tarjeta: /tarjeta|card/ };
    for (const [valor, re] of Object.entries(mapa)) {
      if (re.test(tl)) return { manejado: true, respuesta: await elegirPago(empresaId, contacto, carrito, valor) };
    }
    return { manejado: true, respuesta: { texto: 'Elige una opción: Efectivo, Transferencia, Tarjeta, o escribe "cancelar" para cancelar tu pedido.' } };
  }

  if (carrito.paso === 'esperando_confirmacion') {
    if (/^(s[ií]|confirmar|confirmo|va|de acuerdo|ok)/.test(tl)) return { manejado: true, respuesta: await confirmarPedidoFinal(empresaId, contacto, carrito) };
    if (/cancelar|^no\b/.test(tl)) return { manejado: true, respuesta: await flujoCancelarCarrito(empresaId, contacto) };
    if (/quitar|eliminar/.test(tl)) return { manejado: true, respuesta: await flujoQuitar(empresaId, contacto, '') };
    return { manejado: true, respuesta: { texto: 'Usa los botones para confirmar o cancelar tu pedido, o escribe "quitar" para editar productos.' } };
  }

  return { manejado: false };
}

// Pedido más reciente de este contacto esperando la foto de la receta (para
// que whatsapp.service reconozca a qué pedido pertenece una imagen entrante).
async function pedidoEsperandoReceta(empresaId, contactoId) {
  const [[row]] = await pool.query(
    `SELECT id, folio FROM pedidos_whatsapp
     WHERE empresa_id = ? AND contacto_id = ? AND receta_estatus = 'pendiente' AND estatus <> 'cancelado'
     ORDER BY id DESC LIMIT 1`,
    [empresaId, contactoId]
  );
  return row || null;
}

async function guardarFotoReceta(pedidoId, rutaArchivo) {
  await pool.query(`UPDATE pedidos_whatsapp SET receta_foto_path = ?, receta_estatus = 'recibida' WHERE id = ?`, [rutaArchivo, pedidoId]);
}

module.exports = {
  manejarBoton, manejarPasoPendiente, manejarIntencionIA, mostrarProductoConOpcionAgregar,
  pedidoEsperandoReceta, guardarFotoReceta, resolverSucursal,
};
