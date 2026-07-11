/**
 * Lógica transaccional del inventario (kardex).
 * Todas las primitivas reciben una conexión `conn` con transacción ABIERTA por el llamador,
 * para poder componerlas (ej. el importador hace muchas en una sola transacción).
 *
 * Reglas:
 *  - RN-INV-01: producto con control → exige numero_lote (caducidad recomendada).
 *  - RN-INV-02: producto sin control → lote 'GENERICO', caducidad null, es_generico=1.
 *  - RN-INV-03: ninguna salida deja cantidad negativa.
 *  - RN-INV-05: toda variación de existencia inserta un movimiento.
 */

const LOTE_GENERICO = 'GENERICO';

async function genFolio(conn, serie) {
  await conn.query('CALL sp_generar_folio(?, @f)', [serie]);
  const [[{ f }]] = await conn.query('SELECT @f AS f');
  return f;
}

// Devuelve el id del lote (producto × numero_lote × ubicacion). Lo crea si no existe.
async function getOrCreateLote(conn, { producto_id, numero_lote, ubicacion_id, almacen_id,
  fecha_caducidad = null, costo_unitario = 0, es_generico = 0, proveedor_id = null }) {
  const [[lote]] = await conn.query(
    `SELECT id, cantidad_actual FROM inventario_lotes
     WHERE producto_id = ? AND numero_lote = ? AND ubicacion_id <=> ?
     FOR UPDATE`,
    [producto_id, numero_lote, ubicacion_id]
  );
  if (lote) return lote.id;
  const [r] = await conn.query(
    `INSERT INTO inventario_lotes
       (producto_id, proveedor_id, numero_lote, fecha_caducidad,
        cantidad_inicial, cantidad_actual, costo_unitario, fecha_entrada,
        almacen_id, ubicacion_id, es_generico)
     VALUES (?, ?, ?, ?, 0, 0, ?, CURDATE(), ?, ?, ?)`,
    [producto_id, proveedor_id, numero_lote, fecha_caducidad,
     costo_unitario, almacen_id, ubicacion_id, es_generico ? 1 : 0]
  );
  return r.insertId;
}

// Normaliza lote/caducidad según el control del producto.
// permitirSinLote = true (carga masiva): un producto con control sin lote usa 'SIN-LOTE'
// en lugar de fallar; en alta manual (false) se exige el lote.
async function resolverLoteSegunControl(conn, producto_id, numero_lote, fecha_caducidad, permitirSinLote = false) {
  const [[prod]] = await conn.query(
    'SELECT control_lote_caducidad FROM productos WHERE id = ?', [producto_id]
  );
  if (!prod) throw Object.assign(new Error('Producto no existe'), { status: 404 });
  if (!prod.control_lote_caducidad) {
    return { numero_lote: LOTE_GENERICO, fecha_caducidad: null, es_generico: 1 };
  }
  const nl = (numero_lote || '').toString().trim();
  if (!nl) {
    if (permitirSinLote) return { numero_lote: 'SIN-LOTE', fecha_caducidad: fecha_caducidad || null, es_generico: 0 };
    throw Object.assign(new Error('Este producto requiere número de lote'), { status: 400 });
  }
  return { numero_lote: nl, fecha_caducidad: fecha_caducidad || null, es_generico: 0 };
}

async function registrarEntrada(conn, d) {
  const { producto_id, almacen_id, ubicacion_id, cantidad,
    costo_unitario = 0, proveedor_id = null, motivo = null, referencia = null, usuario_id = null } = d;
  const cant = parseFloat(cantidad);
  if (!(cant > 0)) throw Object.assign(new Error('Cantidad debe ser > 0'), { status: 400 });

  const norm = await resolverLoteSegunControl(conn, producto_id, d.numero_lote, d.fecha_caducidad, d.permitir_sin_lote);
  const loteId = await getOrCreateLote(conn, {
    producto_id, ubicacion_id, almacen_id, costo_unitario, proveedor_id,
    numero_lote: norm.numero_lote, fecha_caducidad: norm.fecha_caducidad, es_generico: norm.es_generico,
  });
  await conn.query(
    `UPDATE inventario_lotes
       SET cantidad_inicial = cantidad_inicial + ?, cantidad_actual = cantidad_actual + ?,
           costo_unitario = ?, fecha_caducidad = COALESCE(?, fecha_caducidad)
     WHERE id = ?`,
    [cant, cant, costo_unitario, norm.fecha_caducidad, loteId]
  );
  const folio = await genFolio(conn, 'ENT');
  await conn.query(
    `INSERT INTO inventario_movimientos
       (folio, tipo, producto_id, lote_id, ubicacion_destino_id, cantidad, costo_unitario, motivo, referencia, usuario_id)
     VALUES (?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [folio, producto_id, loteId, ubicacion_id, cant, costo_unitario, motivo, referencia, usuario_id]
  );
  return { folio, lote_id: loteId };
}

async function registrarSalida(conn, d) {
  const { lote_id, cantidad, motivo = null, referencia = null, usuario_id = null } = d;
  const cant = parseFloat(cantidad);
  if (!(cant > 0)) throw Object.assign(new Error('Cantidad debe ser > 0'), { status: 400 });
  const [[lote]] = await conn.query(
    'SELECT id, producto_id, ubicacion_id, cantidad_actual, costo_unitario FROM inventario_lotes WHERE id = ? FOR UPDATE',
    [lote_id]
  );
  if (!lote) throw Object.assign(new Error('Lote no encontrado'), { status: 404 });
  if (Number(lote.cantidad_actual) < cant) {
    throw Object.assign(new Error(`Existencia insuficiente (disponible: ${lote.cantidad_actual})`), { status: 400 });
  }
  await conn.query('UPDATE inventario_lotes SET cantidad_actual = cantidad_actual - ? WHERE id = ?', [cant, lote_id]);
  const folio = await genFolio(conn, 'SAL');
  await conn.query(
    `INSERT INTO inventario_movimientos
       (folio, tipo, producto_id, lote_id, ubicacion_origen_id, cantidad, costo_unitario, motivo, referencia, usuario_id)
     VALUES (?, 'salida', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [folio, lote.producto_id, lote_id, lote.ubicacion_id, -cant, lote.costo_unitario, motivo, referencia, usuario_id]
  );
  return { folio };
}

async function registrarTraspaso(conn, d) {
  const { lote_id, ubicacion_destino_id, cantidad, motivo = null, usuario_id = null } = d;
  const cant = parseFloat(cantidad);
  if (!(cant > 0)) throw Object.assign(new Error('Cantidad debe ser > 0'), { status: 400 });
  if (!ubicacion_destino_id) throw Object.assign(new Error('Ubicación destino requerida'), { status: 400 });
  const [[lote]] = await conn.query(
    `SELECT id, producto_id, numero_lote, fecha_caducidad, costo_unitario, es_generico,
            almacen_id, ubicacion_id, cantidad_actual
     FROM inventario_lotes WHERE id = ? FOR UPDATE`, [lote_id]
  );
  if (!lote) throw Object.assign(new Error('Lote no encontrado'), { status: 404 });
  if (Number(lote.ubicacion_id) === Number(ubicacion_destino_id))
    throw Object.assign(new Error('La ubicación destino es la misma'), { status: 400 });
  if (Number(lote.cantidad_actual) < cant)
    throw Object.assign(new Error(`Existencia insuficiente (disponible: ${lote.cantidad_actual})`), { status: 400 });

  const [[ubDest]] = await conn.query('SELECT almacen_id FROM ubicaciones WHERE id = ?', [ubicacion_destino_id]);
  const destLoteId = await getOrCreateLote(conn, {
    producto_id: lote.producto_id, numero_lote: lote.numero_lote, ubicacion_id: ubicacion_destino_id,
    almacen_id: ubDest ? ubDest.almacen_id : lote.almacen_id,
    fecha_caducidad: lote.fecha_caducidad, costo_unitario: lote.costo_unitario, es_generico: lote.es_generico,
  });
  await conn.query('UPDATE inventario_lotes SET cantidad_actual = cantidad_actual - ? WHERE id = ?', [cant, lote_id]);
  await conn.query('UPDATE inventario_lotes SET cantidad_actual = cantidad_actual + ?, cantidad_inicial = cantidad_inicial + ? WHERE id = ?', [cant, cant, destLoteId]);
  const folio = await genFolio(conn, 'TRA');
  await conn.query(
    `INSERT INTO inventario_movimientos
       (folio, tipo, producto_id, lote_id, lote_destino_id, ubicacion_origen_id, ubicacion_destino_id, cantidad, costo_unitario, motivo, usuario_id)
     VALUES (?, 'traspaso', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [folio, lote.producto_id, lote_id, destLoteId, lote.ubicacion_id, ubicacion_destino_id, cant, lote.costo_unitario, motivo, usuario_id]
  );
  return { folio, lote_destino_id: destLoteId };
}

async function registrarAjuste(conn, d) {
  const { lote_id, cantidad_nueva, motivo = null, usuario_id = null } = d;
  const nueva = parseFloat(cantidad_nueva);
  if (isNaN(nueva) || nueva < 0) throw Object.assign(new Error('Cantidad nueva inválida'), { status: 400 });
  const [[lote]] = await conn.query(
    'SELECT id, producto_id, ubicacion_id, cantidad_actual, costo_unitario FROM inventario_lotes WHERE id = ? FOR UPDATE',
    [lote_id]
  );
  if (!lote) throw Object.assign(new Error('Lote no encontrado'), { status: 404 });
  const delta = nueva - Number(lote.cantidad_actual);
  await conn.query('UPDATE inventario_lotes SET cantidad_actual = ? WHERE id = ?', [nueva, lote_id]);
  const folio = await genFolio(conn, 'AJU');
  await conn.query(
    `INSERT INTO inventario_movimientos
       (folio, tipo, producto_id, lote_id, ubicacion_origen_id, cantidad, costo_unitario, motivo, usuario_id)
     VALUES (?, 'ajuste', ?, ?, ?, ?, ?, ?, ?)`,
    [folio, lote.producto_id, lote_id, lote.ubicacion_id, delta, lote.costo_unitario,
     motivo || 'Ajuste por inventario físico', usuario_id]
  );
  return { folio, delta };
}

// Salida por FEFO: descuenta `cantidad` de un producto tomando primero los lotes que
// caducan antes (null = sin caducidad, al final). No permite quedar negativo.
// `almacen_id` (opcional) restringe la salida a los lotes de ese almacén — lo usa la
// venta de mostrador (POS) para descontar solo del almacén de la sucursal; sin él,
// el comportamiento es el de siempre (todos los almacenes).
// Devuelve además el desglose de lotes consumidos (para la bitácora COFEPRIS del POS).
async function registrarSalidaFEFO(conn, { producto_id, cantidad, motivo = null, referencia = null, usuario_id = null, almacen_id = null }) {
  const cant = parseFloat(cantidad);
  if (!(cant > 0)) throw Object.assign(new Error('Cantidad debe ser > 0'), { status: 400 });
  const params = [producto_id];
  let filtroAlmacen = '';
  if (almacen_id) { filtroAlmacen = ' AND almacen_id = ?'; params.push(almacen_id); }
  const [lotes] = await conn.query(
    `SELECT id, numero_lote, fecha_caducidad, cantidad_actual FROM inventario_lotes
     WHERE producto_id = ? AND cantidad_actual > 0${filtroAlmacen}
     ORDER BY fecha_caducidad IS NULL, fecha_caducidad ASC, id ASC
     FOR UPDATE`, params
  );
  const disponible = lotes.reduce((a, l) => a + Number(l.cantidad_actual), 0);
  if (disponible < cant) {
    throw Object.assign(new Error(`Existencia insuficiente (disponible: ${disponible}, requerido: ${cant})`), { status: 400, disponible });
  }
  let resta = cant;
  const folios = [];
  const lotesConsumidos = [];
  for (const l of lotes) {
    if (resta <= 0) break;
    const toma = Math.min(resta, Number(l.cantidad_actual));
    const out = await registrarSalida(conn, { lote_id: l.id, cantidad: toma, motivo, referencia, usuario_id });
    folios.push(out.folio);
    lotesConsumidos.push({
      lote_id: l.id,
      lote: l.numero_lote,
      caducidad: l.fecha_caducidad,
      cantidad: toma,
    });
    resta -= toma;
  }
  return { folios, lotes: lotesConsumidos };
}

module.exports = {
  LOTE_GENERICO, genFolio, getOrCreateLote,
  registrarEntrada, registrarSalida, registrarSalidaFEFO, registrarTraspaso, registrarAjuste,
};
