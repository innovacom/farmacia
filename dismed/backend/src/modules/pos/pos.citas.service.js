/**
 * pos.citas.service.js — Agenda de citas médicas del mostrador.
 * No hay médico asignado (no importa quién esté de guardia): solo se aparta
 * horario + paciente. El cobro reusa la venta normal de mostrador; este
 * servicio solo liga la venta ya creada (ver pos.controller.js#pagarCita).
 */
const { pool } = require('../../config/db');
const { getScoped } = require('./pos.tenant.helpers');

const DURACION_MIN = 30;
const APERTURA_MIN = 10 * 60; // 10:00
const CIERRE_MIN = 20 * 60;   // 20:00

function minutosDeHora(hhmm) {
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

// Lunes a sábado, 10:00-20:00. `fecha` en formato 'YYYY-MM-DD' tal cual la
// manda el <input type=date> — no se reconstruye desde un Date ya leído de
// la BD para no arrastrar corrimientos de zona horaria.
function validarHorario(fecha, hora_inicio, duracion_min) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw badRequest('fecha inválida');
  const dow = new Date(`${fecha}T12:00:00`).getDay(); // mediodía: evita cruzar de día por TZ
  if (dow === 0) throw badRequest('No hay citas los domingos (horario: lunes a sábado)');
  const inicio = minutosDeHora(hora_inicio);
  const fin = inicio + duracion_min;
  if (!Number.isFinite(inicio) || inicio < APERTURA_MIN || fin > CIERRE_MIN) {
    throw badRequest('Horario de atención: 10:00 a 20:00');
  }
}

async function verificarDisponible(empresaId, { sucursal_id, fecha, hora_inicio, duracion_min, excluir_id }) {
  const params = [empresaId, sucursal_id, fecha];
  let where = "empresa_id = ? AND sucursal_id = ? AND fecha = ? AND estatus IN ('agendada','atendida')";
  if (excluir_id) { where += ' AND id != ?'; params.push(excluir_id); }
  const [rows] = await pool.query(
    `SELECT hora_inicio, duracion_min FROM pos_citas WHERE ${where}`, params
  );
  const nuevoInicio = minutosDeHora(hora_inicio);
  const nuevoFin = nuevoInicio + duracion_min;
  const choque = rows.some((r) => {
    const ini = minutosDeHora(r.hora_inicio);
    const fin = ini + r.duracion_min;
    return nuevoInicio < fin && nuevoFin > ini;
  });
  if (choque) {
    const err = new Error('Ese horario ya está ocupado en esta sucursal');
    err.status = 409;
    throw err;
  }
}

// Servicios agendables: productos del catálogo cuya familia sea "MEDICO"
// (exacto, no LIKE: la familia "MEDICAMENTOS" también contiene "medic" y son
// cosas distintas — MEDICO son los servicios de consulta/examen, no fármacos).
// Catálogo de productos/familias es global (no vive por empresa_id).
async function listarServicios() {
  const [rows] = await pool.query(
    `SELECT p.id, p.sku_interno, p.descripcion, p.precio_lista
     FROM productos p JOIN familias f ON f.id = p.familia_id
     WHERE p.activo = 1 AND p.vendible = 1 AND f.nombre IN ('MEDICO', 'MÉDICO')
     ORDER BY p.descripcion`
  );
  return rows;
}

async function obtenerServicio(producto_id) {
  const [rows] = await pool.query(
    `SELECT p.id, p.descripcion, p.precio_lista
     FROM productos p JOIN familias f ON f.id = p.familia_id
     WHERE p.id = ? AND p.activo = 1 AND p.vendible = 1 AND f.nombre IN ('MEDICO', 'MÉDICO')`,
    [producto_id]
  );
  if (!rows.length) throw badRequest('Servicio inválido: elige uno de la familia médico');
  return rows[0];
}

async function listarCitas(empresaId, { sucursal_id, desde, hasta, estatus }) {
  const params = [empresaId];
  let where = 'c.empresa_id = ?';
  if (sucursal_id) { where += ' AND c.sucursal_id = ?'; params.push(sucursal_id); }
  if (desde) { where += ' AND c.fecha >= ?'; params.push(desde); }
  if (hasta) { where += ' AND c.fecha <= ?'; params.push(hasta); }
  if (estatus) { where += ' AND c.estatus = ?'; params.push(estatus); }
  const [rows] = await pool.query(
    `SELECT c.*, s.nombre AS sucursal_nombre, u.nombre AS creado_por_nombre,
            v.folio AS venta_folio, v.total AS venta_total
     FROM pos_citas c
     JOIN sucursales s ON s.id = c.sucursal_id
     JOIN usuarios u ON u.id = c.creado_por
     LEFT JOIN pos_ventas v ON v.id = c.venta_id
     WHERE ${where}
     ORDER BY c.fecha, c.hora_inicio`,
    params
  );
  return rows;
}

async function detalleCita(empresaId, id) {
  const [rows] = await pool.query(
    `SELECT c.*, s.nombre AS sucursal_nombre
     FROM pos_citas c JOIN sucursales s ON s.id = c.sucursal_id
     WHERE c.id = ? AND c.empresa_id = ?`,
    [id, empresaId]
  );
  if (!rows.length) {
    const err = new Error('No encontrado');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

async function crearCita(empresaId, { sucursal_id, fecha, hora_inicio, producto_id, paciente_nombre, paciente_telefono, notas, usuario_id }) {
  if (!sucursal_id || !fecha || !hora_inicio || !producto_id || !paciente_nombre?.trim()) {
    throw badRequest('sucursal_id, fecha, hora_inicio, producto_id (servicio) y paciente_nombre requeridos');
  }
  validarHorario(fecha, hora_inicio, DURACION_MIN);
  await getScoped(pool, 'sucursales', sucursal_id, empresaId);
  await verificarDisponible(empresaId, { sucursal_id, fecha, hora_inicio, duracion_min: DURACION_MIN });
  const servicio = await obtenerServicio(producto_id);

  const [r] = await pool.query(
    `INSERT INTO pos_citas
       (empresa_id, sucursal_id, fecha, hora_inicio, duracion_min,
        producto_id, servicio_descripcion, servicio_precio,
        paciente_nombre, paciente_telefono, notas, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, sucursal_id, fecha, hora_inicio, DURACION_MIN,
     servicio.id, servicio.descripcion, servicio.precio_lista,
     paciente_nombre.trim(), paciente_telefono?.trim() || null, notas?.trim() || null, usuario_id]
  );
  return { id: r.insertId };
}

async function updateCita(empresaId, id, { fecha, hora_inicio, producto_id, paciente_nombre, paciente_telefono, notas }) {
  if (!fecha || !hora_inicio || !producto_id || !paciente_nombre?.trim()) {
    throw badRequest('fecha, hora_inicio, producto_id (servicio) y paciente_nombre requeridos');
  }
  const cita = await getScoped(pool, 'pos_citas', id, empresaId);
  if (cita.estatus !== 'agendada') {
    const err = new Error('Solo se puede editar una cita agendada (no cobrada ni cancelada)');
    err.status = 409;
    throw err;
  }
  validarHorario(fecha, hora_inicio, cita.duracion_min);
  await verificarDisponible(empresaId, {
    sucursal_id: cita.sucursal_id, fecha, hora_inicio,
    duracion_min: cita.duracion_min, excluir_id: id,
  });
  const servicio = await obtenerServicio(producto_id);

  await pool.query(
    `UPDATE pos_citas
     SET fecha = ?, hora_inicio = ?, producto_id = ?, servicio_descripcion = ?, servicio_precio = ?,
         paciente_nombre = ?, paciente_telefono = ?, notas = ?,
         reprogramar_solicitado = 0, reprogramar_solicitado_en = NULL
     WHERE id = ? AND empresa_id = ?`,
    [fecha, hora_inicio, servicio.id, servicio.descripcion, servicio.precio_lista,
     paciente_nombre.trim(), paciente_telefono?.trim() || null, notas?.trim() || null, id, empresaId]
  );
  return { ok: true };
}

async function cancelarCita(empresaId, id, { motivo, usuario_id }) {
  const cita = await getScoped(pool, 'pos_citas', id, empresaId);
  if (cita.pagada) {
    const err = new Error('No se puede cancelar una cita ya cobrada');
    err.status = 409;
    throw err;
  }
  if (cita.estatus === 'cancelada') {
    const err = new Error('Esa cita ya estaba cancelada');
    err.status = 409;
    throw err;
  }
  await pool.query(
    `UPDATE pos_citas SET estatus = 'cancelada', cancelada_en = NOW(), cancelada_por = ?, motivo_cancelacion = ?
     WHERE id = ? AND empresa_id = ?`,
    [usuario_id, motivo?.trim() || null, id, empresaId]
  );
  return { ok: true };
}

// Citas de hoy/mañana que siguen "agendada" y sin confirmar con el paciente:
// el POS de venta las muestra como recordatorio para que el empleado llame o
// escriba por WhatsApp antes de que se presente (o no) a su cita.
async function pendientesConfirmar(empresaId, sucursalId) {
  const [rows] = await pool.query(
    `SELECT id, sucursal_id, fecha, hora_inicio, paciente_nombre, paciente_telefono, servicio_descripcion
     FROM pos_citas
     WHERE empresa_id = ? AND sucursal_id = ? AND estatus = 'agendada' AND confirmada = 0
       AND fecha BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 1 DAY)
     ORDER BY fecha, hora_inicio`,
    [empresaId, sucursalId]
  );
  return rows;
}

async function confirmarCita(empresaId, id, { usuario_id }) {
  const cita = await getScoped(pool, 'pos_citas', id, empresaId);
  if (cita.estatus !== 'agendada') {
    const err = new Error('Solo se puede confirmar una cita agendada');
    err.status = 409;
    throw err;
  }
  if (cita.confirmada) {
    const err = new Error('Esa cita ya estaba confirmada');
    err.status = 409;
    throw err;
  }
  await pool.query(
    `UPDATE pos_citas SET confirmada = 1, confirmada_en = NOW(), confirmada_por = ?
     WHERE id = ? AND empresa_id = ?`,
    [usuario_id, id, empresaId]
  );
  return { ok: true };
}

// El paciente pidió reprogramar por WhatsApp: no se reagenda solo (requiere
// elegir nuevo horario), solo se marca para que el empleado le devuelva el
// contacto. No cambia el estatus 'agendada' — sigue apareciendo en la agenda.
async function marcarReprogramarSolicitado(empresaId, id) {
  await getScoped(pool, 'pos_citas', id, empresaId);
  await pool.query(
    `UPDATE pos_citas SET reprogramar_solicitado = 1, reprogramar_solicitado_en = NOW()
     WHERE id = ? AND empresa_id = ?`,
    [id, empresaId]
  );
  return { ok: true };
}

// Se liga a una venta de mostrador YA creada (venta_id): el cobro es una
// venta normal (con o sin productos previamente agendados), esto solo
// marca la cita como pagada/atendida y guarda la referencia.
async function marcarPagada(empresaId, id, { venta_id }) {
  const cita = await getScoped(pool, 'pos_citas', id, empresaId);
  if (cita.estatus === 'cancelada') {
    const err = new Error('Esa cita está cancelada');
    err.status = 409;
    throw err;
  }
  if (cita.pagada) {
    const err = new Error('Esa cita ya estaba pagada');
    err.status = 409;
    throw err;
  }
  await getScoped(pool, 'pos_ventas', venta_id, empresaId);
  await pool.query(
    `UPDATE pos_citas SET pagada = 1, pagada_en = NOW(), venta_id = ?, estatus = 'atendida'
     WHERE id = ? AND empresa_id = ?`,
    [venta_id, id, empresaId]
  );
  return { ok: true };
}

module.exports = {
  listarServicios, listarCitas, detalleCita, crearCita, updateCita, cancelarCita, marcarPagada,
  pendientesConfirmar, confirmarCita, marcarReprogramarSolicitado,
};
