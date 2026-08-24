/**
 * apertura.controller.js — Saldos iniciales / póliza de apertura por ejercicio.
 *
 * Fase A del plan de corrección del módulo contable (revisión 2026-08-24): el sistema
 * NO debe presumir que existe un punto de partida real. La apertura de enero 2026
 * cargada originalmente (junio 2026) fue un dato de PRUEBA, no la balanza real que
 * entrega el contador — quedó marcada `verificada=0` por migrate_v63.
 *
 * Mientras una apertura no esté verificada (o no exista), los 3 reportes contables
 * (contabilidad.reportes.service.js) muestran una advertencia explícita; esta apertura
 * NUNCA se usa para decidir nada del motor de pólizas automático (polizas.generator.js
 * genera por CFDI/inventario, independiente del estado de la apertura).
 *
 *   GET    /contabilidad/apertura?anio=2026        estado + detalle si existe
 *   POST   /contabilidad/apertura                  crea/reemplaza la apertura del ejercicio
 *   DELETE /contabilidad/apertura?anio=2026         la quita (arrancar el ejercicio en $0)
 *
 * Solo admin (rutas montadas con adminOnly): reescribir el punto de partida contable
 * es una operación sensible, igual que Descargas SAT.
 */
const { pool } = require('../../config/db');
const { estadoApertura } = require('./contabilidad.reportes.service');

async function obtener(req, res, next) {
  try {
    const anio = parseInt(req.query.anio, 10);
    if (!anio) return res.status(400).json({ error: 'anio es obligatorio' });

    const estado = await estadoApertura(anio);
    const [[poliza]] = await pool.query(
      `SELECT id, fecha, concepto, verificada, total_cargos, total_abonos
         FROM polizas WHERE periodo_anio=? AND origen='apertura' LIMIT 1`, [anio]);

    let movimientos = [];
    if (poliza) {
      const [rows] = await pool.query(
        `SELECT m.cuenta_codigo, c.nombre AS cuenta_nombre, c.rubro, m.cargo, m.abono, m.concepto
           FROM polizas_movimientos m
           LEFT JOIN sat_cuentas_agrupador c ON c.codigo = m.cuenta_codigo COLLATE utf8mb4_general_ci
          WHERE m.poliza_id = ? ORDER BY m.cuenta_codigo`, [poliza.id]);
      movimientos = rows;
    }
    res.json({ anio, ...estado, poliza: poliza || null, movimientos });
  } catch (err) { next(err); }
}

// Valida cuadre y existencia de cuentas; no exige entidad_tipo (la apertura es a
// nivel agrupador, no auxiliar por cliente/proveedor).
async function validarMovimientos(movimientos) {
  if (!Array.isArray(movimientos) || movimientos.length < 2) {
    const e = new Error('La apertura requiere al menos 2 cuentas'); e.status = 400; throw e;
  }
  const rows = movimientos.map((m) => ({
    cuenta_codigo: String(m.cuenta_codigo || '').trim(),
    cargo: Math.round((Number(m.cargo) || 0) * 100) / 100,
    abono: Math.round((Number(m.abono) || 0) * 100) / 100,
    concepto: m.concepto ? String(m.concepto).slice(0, 255) : null,
  }));
  for (const r of rows) {
    if (!r.cuenta_codigo) { const e = new Error('Hay una cuenta sin código'); e.status = 400; throw e; }
    if (r.cargo < 0 || r.abono < 0) { const e = new Error('Cargo/abono no pueden ser negativos'); e.status = 400; throw e; }
    if (r.cargo > 0 && r.abono > 0) { const e = new Error(`La cuenta ${r.cuenta_codigo} tiene cargo y abono a la vez`); e.status = 400; throw e; }
  }
  const codes = [...new Set(rows.map((r) => r.cuenta_codigo))];
  const [cat] = await pool.query(
    `SELECT codigo, rubro FROM sat_cuentas_agrupador WHERE codigo IN (?)`, [codes]);
  const map = new Map(cat.map((c) => [c.codigo, c.rubro]));
  const faltan = codes.filter((c) => !map.has(c));
  if (faltan.length) { const e = new Error('Cuentas inexistentes en el catálogo: ' + faltan.join(', ')); e.status = 400; throw e; }

  const total_cargos = Math.round(rows.reduce((s, r) => s + r.cargo, 0) * 100) / 100;
  const total_abonos = Math.round(rows.reduce((s, r) => s + r.abono, 0) * 100) / 100;
  if (Math.abs(total_cargos - total_abonos) >= 0.01) {
    const e = new Error(`La apertura no cuadra: cargos ${total_cargos} ≠ abonos ${total_abonos}`);
    e.status = 400; throw e;
  }
  // Aviso (no bloqueante): 502 "Compras" en una apertura suele indicar inventario
  // valuado con método periódico, inconsistente con el motor automático (perpetuo,
  // cuenta 115.01). Fase E del plan — ver Reporte Módulo Contable DISMED.
  const avisos = [];
  if (codes.includes('502')) {
    avisos.push('La cuenta 502 (Compras) está en los saldos iniciales. El motor automático ' +
      'usa 115.01 (Inventario, método perpetuo) desde el primer periodo generado; si 502 ' +
      'representa mercancía en existencia, considera mapearla a 115.01 para no tener dos ' +
      'metodologías de inventario en el mismo ejercicio.');
  }
  return { rows, total_cargos, total_abonos, avisos };
}

// POST /contabilidad/apertura — crea o reemplaza la apertura del ejercicio.
async function guardar(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { anio, fecha_corte, movimientos, verificada } = req.body;
    const anioN = parseInt(anio, 10);
    if (!anioN) { conn.release(); return res.status(400).json({ error: 'anio es obligatorio' }); }
    if (!fecha_corte) { conn.release(); return res.status(400).json({ error: 'fecha_corte es obligatoria' }); }

    const { rows, total_cargos, total_abonos, avisos } = await validarMovimientos(movimientos);
    const mes = Number(String(fecha_corte).slice(5, 7));
    const esVerificada = verificada ? 1 : 0;

    await conn.beginTransaction();
    const [del] = await conn.query(
      "DELETE FROM polizas WHERE origen='apertura' AND periodo_anio=?", [anioN]);
    const [r] = await conn.query(
      `INSERT INTO polizas
         (tipo, fecha, periodo_anio, periodo_mes, concepto, origen, referencia,
          total_cargos, total_abonos, estado, verificada, usuario_id)
       VALUES ('diario', ?, ?, ?, ?, 'apertura', 'APERTURA', ?, ?, 'confirmada', ?, ?)`,
      [fecha_corte, anioN, mes,
       `Saldos iniciales / apertura ${anioN} (corte ${fecha_corte})${esVerificada ? '' : ' — PROVISIONAL'}`,
       total_cargos, total_abonos, esVerificada, req.user && req.user.id]);
    const pid = r.insertId;
    await conn.query(
      `INSERT INTO polizas_movimientos (poliza_id, cuenta_codigo, cargo, abono, concepto)
       VALUES ?`, [rows.map((m) => [pid, m.cuenta_codigo, m.cargo, m.abono, m.concepto])]);
    await conn.commit();

    res.status(201).json({
      id: pid, anio: anioN, total_cargos, total_abonos, verificada: !!esVerificada,
      avisos, reemplazadas: del.affectedRows,
    });
  } catch (err) { await conn.rollback(); next(err); }
  finally { conn.release(); }
}

// DELETE /contabilidad/apertura?anio=2026 — quita la apertura (arranca el ejercicio en $0).
async function eliminar(req, res, next) {
  try {
    const anio = parseInt(req.query.anio, 10);
    if (!anio) return res.status(400).json({ error: 'anio es obligatorio' });
    const [r] = await pool.query(
      "DELETE FROM polizas WHERE origen='apertura' AND periodo_anio=?", [anio]);
    res.json({ ok: true, eliminadas: r.affectedRows });
  } catch (err) { next(err); }
}

module.exports = { obtener, guardar, eliminar };
