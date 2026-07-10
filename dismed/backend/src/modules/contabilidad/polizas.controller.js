/**
 * polizas.controller.js — Pólizas contables derivadas de CFDI + inventario.
 *   POST /contabilidad/polizas/generar   { anio, mes }  regenera el periodo
 *   GET  /contabilidad/polizas           ?anio&mes[&tipo&origen]  lista con movimientos
 *   GET  /contabilidad/polizas/balanza   ?anio&mes  saldos por cuenta real (auxiliar)
 */
const { pool } = require('../../config/db');
const { generarPeriodo, boundsMes } = require('./polizas.generator');

async function generar(req, res, next) {
  try {
    const anio = req.body.anio || req.query.anio;
    const mes = req.body.mes || req.query.mes;
    const resumen = await generarPeriodo({ anio, mes }, req.user && req.user.id);
    res.json(resumen);
  } catch (err) { next(err); }
}

// Lista las pólizas de un periodo con sus movimientos anidados.
async function listar(req, res, next) {
  try {
    const anio = parseInt(req.query.anio, 10);
    const mes = parseInt(req.query.mes, 10);
    if (!anio || !mes) return res.status(400).json({ error: 'anio y mes son obligatorios' });

    const where = ['periodo_anio=?', 'periodo_mes=?'];
    const vals = [anio, mes];
    if (req.query.tipo) { where.push('tipo=?'); vals.push(req.query.tipo); }
    if (req.query.origen) { where.push('origen=?'); vals.push(req.query.origen); }

    const [polizas] = await pool.query(
      `SELECT id, tipo, fecha, concepto, origen, estado, cfdi_uuid, referencia,
              total_cargos, total_abonos
         FROM polizas WHERE ${where.join(' AND ')}
        ORDER BY fecha, id`, vals);

    let movs = [];
    if (polizas.length) {
      const ids = polizas.map((p) => p.id);
      const [rows] = await pool.query(
        `SELECT m.poliza_id, m.cuenta_codigo, c.nombre AS cuenta_nombre,
                m.cargo, m.abono, m.concepto, m.entidad_tipo
           FROM polizas_movimientos m
           LEFT JOIN sat_cuentas_agrupador c ON c.codigo = m.cuenta_codigo COLLATE utf8mb4_general_ci
          WHERE m.poliza_id IN (?) ORDER BY m.id`, [ids]);
      movs = rows;
    }
    const porPoliza = new Map();
    for (const m of movs) {
      if (!porPoliza.has(m.poliza_id)) porPoliza.set(m.poliza_id, []);
      porPoliza.get(m.poliza_id).push(m);
    }
    const data = polizas.map((p) => ({ ...p, movimientos: porPoliza.get(p.id) || [] }));

    const tot = data.reduce((s, p) => ({
      cargos: s.cargos + Number(p.total_cargos), abonos: s.abonos + Number(p.total_abonos),
    }), { cargos: 0, abonos: 0 });

    res.json({
      anio, mes, total: data.length,
      total_cargos: Math.round(tot.cargos * 100) / 100,
      total_abonos: Math.round(tot.abonos * 100) / 100,
      polizas: data,
    });
  } catch (err) { next(err); }
}

// Balanza por cuenta REAL (auxiliar): suma cargos/abonos por cuenta del agrupador.
async function balanza(req, res, next) {
  try {
    const anio = parseInt(req.query.anio, 10);
    const mes = parseInt(req.query.mes, 10);
    if (!anio || !mes) return res.status(400).json({ error: 'anio y mes son obligatorios' });

    const [rows] = await pool.query(
      `SELECT m.cuenta_codigo, c.nombre AS cuenta_nombre, c.rubro, c.naturaleza,
              SUM(m.cargo) AS cargos, SUM(m.abono) AS abonos
         FROM polizas_movimientos m
         JOIN polizas p ON p.id = m.poliza_id
         LEFT JOIN sat_cuentas_agrupador c ON c.codigo = m.cuenta_codigo COLLATE utf8mb4_general_ci
        WHERE p.periodo_anio=? AND p.periodo_mes=?
        GROUP BY m.cuenta_codigo, c.nombre, c.rubro, c.naturaleza
        ORDER BY m.cuenta_codigo`, [anio, mes]);

    const cuentas = rows.map((r) => {
      const cargos = Number(r.cargos), abonos = Number(r.abonos);
      // Saldo según naturaleza: deudora = cargos − abonos; acreedora = abonos − cargos.
      const saldo = r.naturaleza === 'A' ? abonos - cargos : cargos - abonos;
      return {
        codigo: r.cuenta_codigo, nombre: r.cuenta_nombre, rubro: r.rubro,
        naturaleza: r.naturaleza,
        cargos: Math.round(cargos * 100) / 100,
        abonos: Math.round(abonos * 100) / 100,
        saldo: Math.round(saldo * 100) / 100,
      };
    });
    const tot = cuentas.reduce((s, c) => ({
      cargos: s.cargos + c.cargos, abonos: s.abonos + c.abonos,
    }), { cargos: 0, abonos: 0 });

    res.json({
      anio, mes, periodo: boundsMes(anio, mes),
      total_cuentas: cuentas.length,
      total_cargos: Math.round(tot.cargos * 100) / 100,
      total_abonos: Math.round(tot.abonos * 100) / 100,
      cuadra: Math.abs(tot.cargos - tot.abonos) < 0.05,
      cuentas,
    });
  } catch (err) { next(err); }
}

// ── Edición / confirmación ──────────────────────────────────────────────────

// Valida y normaliza movimientos; verifica cuadre y existencia de cuentas.
async function prepararMovs(movimientos) {
  if (!Array.isArray(movimientos) || movimientos.length < 2) {
    const e = new Error('La póliza requiere al menos 2 movimientos'); e.status = 400; throw e;
  }
  const rows = movimientos.map((m) => ({
    cuenta_codigo: String(m.cuenta_codigo || '').trim(),
    cargo: Math.round((Number(m.cargo) || 0) * 100) / 100,
    abono: Math.round((Number(m.abono) || 0) * 100) / 100,
    concepto: m.concepto ? String(m.concepto).slice(0, 255) : null,
    entidad_tipo: m.entidad_tipo || null, entidad_id: m.entidad_id || null,
  }));
  for (const r of rows) {
    if (!r.cuenta_codigo) { const e = new Error('Hay un movimiento sin cuenta'); e.status = 400; throw e; }
    if (r.cargo < 0 || r.abono < 0) { const e = new Error('Cargo/abono no pueden ser negativos'); e.status = 400; throw e; }
    if (r.cargo > 0 && r.abono > 0) { const e = new Error(`El movimiento ${r.cuenta_codigo} tiene cargo y abono a la vez`); e.status = 400; throw e; }
  }
  const codes = [...new Set(rows.map((r) => r.cuenta_codigo))];
  const [cat] = await pool.query(
    `SELECT codigo FROM sat_cuentas_agrupador WHERE codigo IN (?)`, [codes]);
  const set = new Set(cat.map((c) => c.codigo));
  const faltan = codes.filter((c) => !set.has(c));
  if (faltan.length) { const e = new Error('Cuentas inexistentes: ' + faltan.join(', ')); e.status = 400; throw e; }

  const total_cargos = Math.round(rows.reduce((s, r) => s + r.cargo, 0) * 100) / 100;
  const total_abonos = Math.round(rows.reduce((s, r) => s + r.abono, 0) * 100) / 100;
  if (Math.abs(total_cargos - total_abonos) >= 0.01) {
    const e = new Error(`La póliza no cuadra: cargos ${total_cargos} ≠ abonos ${total_abonos}`);
    e.status = 400; throw e;
  }
  return { rows, total_cargos, total_abonos };
}

const periodoDeFecha = (fecha) => ({
  anio: parseInt(String(fecha).slice(0, 4), 10),
  mes: parseInt(String(fecha).slice(5, 7), 10),
});

async function getById(req, res, next) {
  try {
    const [[p]] = await pool.query('SELECT * FROM polizas WHERE id=?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Póliza no encontrada' });
    const [movs] = await pool.query(
      `SELECT m.*, c.nombre AS cuenta_nombre FROM polizas_movimientos m
       LEFT JOIN sat_cuentas_agrupador c ON c.codigo=m.cuenta_codigo COLLATE utf8mb4_general_ci
       WHERE m.poliza_id=? ORDER BY m.id`, [p.id]);
    res.json({ ...p, movimientos: movs });
  } catch (err) { next(err); }
}

// POST /polizas — alta manual.
async function crear(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { tipo, fecha, concepto, referencia, movimientos } = req.body;
    if (!fecha) return res.status(400).json({ error: 'fecha es obligatoria' });
    const { rows, total_cargos, total_abonos } = await prepararMovs(movimientos);
    const per = periodoDeFecha(fecha);
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO polizas (tipo, fecha, periodo_anio, periodo_mes, concepto, origen,
         referencia, total_cargos, total_abonos, estado, usuario_id)
       VALUES (?,?,?,?,?,'manual',?,?,?,'confirmada',?)`,
      [tipo || 'diario', fecha, per.anio, per.mes, concepto || null,
       referencia || null, total_cargos, total_abonos, req.user && req.user.id]);
    const pid = r.insertId;
    await conn.query(
      `INSERT INTO polizas_movimientos (poliza_id,cuenta_codigo,cargo,abono,concepto,entidad_tipo,entidad_id)
       VALUES ?`, [rows.map((m) => [pid, m.cuenta_codigo, m.cargo, m.abono, m.concepto, m.entidad_tipo, m.entidad_id])]);
    await conn.commit();
    res.status(201).json({ id: pid, total_cargos, total_abonos });
  } catch (err) { await conn.rollback(); next(err); }
  finally { conn.release(); }
}

// PUT /polizas/:id — actualiza encabezado y, si vienen, reemplaza movimientos.
async function actualizar(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const [[p]] = await conn.query('SELECT * FROM polizas WHERE id=?', [req.params.id]);
    if (!p) { conn.release(); return res.status(404).json({ error: 'Póliza no encontrada' }); }

    const { tipo, fecha, concepto, referencia, estado, movimientos } = req.body;
    await conn.beginTransaction();

    const sets = [], vals = [];
    if (tipo) { sets.push('tipo=?'); vals.push(tipo); }
    if (concepto !== undefined) { sets.push('concepto=?'); vals.push(concepto || null); }
    if (referencia !== undefined) { sets.push('referencia=?'); vals.push(referencia || null); }
    if (estado && ['borrador', 'confirmada'].includes(estado)) { sets.push('estado=?'); vals.push(estado); }
    if (fecha) {
      const per = periodoDeFecha(fecha);
      sets.push('fecha=?', 'periodo_anio=?', 'periodo_mes=?'); vals.push(fecha, per.anio, per.mes);
    }

    if (Array.isArray(movimientos)) {
      const { rows, total_cargos, total_abonos } = await prepararMovs(movimientos);
      await conn.query('DELETE FROM polizas_movimientos WHERE poliza_id=?', [p.id]);
      await conn.query(
        `INSERT INTO polizas_movimientos (poliza_id,cuenta_codigo,cargo,abono,concepto,entidad_tipo,entidad_id)
         VALUES ?`, [rows.map((m) => [p.id, m.cuenta_codigo, m.cargo, m.abono, m.concepto, m.entidad_tipo, m.entidad_id])]);
      sets.push('total_cargos=?', 'total_abonos=?'); vals.push(total_cargos, total_abonos);
    }
    if (sets.length) await conn.query(`UPDATE polizas SET ${sets.join(', ')} WHERE id=?`, [...vals, p.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) { await conn.rollback(); next(err); }
  finally { conn.release(); }
}

// DELETE /polizas/:id
async function eliminar(req, res, next) {
  try {
    const [[p]] = await pool.query('SELECT origen FROM polizas WHERE id=?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Póliza no encontrada' });
    await pool.query('DELETE FROM polizas WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// POST /polizas/confirmar — confirma en bloque las borrador de un periodo.
async function confirmarPeriodo(req, res, next) {
  try {
    const anio = parseInt(req.body.anio || req.query.anio, 10);
    const mes = parseInt(req.body.mes || req.query.mes, 10);
    if (!anio || !mes) return res.status(400).json({ error: 'anio y mes son obligatorios' });
    const [r] = await pool.query(
      "UPDATE polizas SET estado='confirmada' WHERE periodo_anio=? AND periodo_mes=? AND estado='borrador'",
      [anio, mes]);
    res.json({ confirmadas: r.affectedRows });
  } catch (err) { next(err); }
}

module.exports = {
  generar, listar, balanza, getById, crear, actualizar, eliminar, confirmarPeriodo,
};
