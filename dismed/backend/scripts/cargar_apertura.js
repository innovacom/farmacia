/**
 * cargar_apertura.js — Carga la póliza de saldos iniciales desde
 * scripts/saldos_iniciales_2026.json (generado por parse_apertura.js).
 *
 *   node scripts/cargar_apertura.js
 *
 * Crea UNA póliza origen='apertura' fechada al cierre (31-ene-2026), periodo 2026/1,
 * con un movimiento por cuenta del agrupador. Idempotente: borra la apertura previa
 * del mismo ejercicio antes de insertar. Valida el cuadre Debe=Haber.
 *
 * Requiere migrate_v22 (origen 'apertura') y que las cuentas existan en
 * sat_cuentas_agrupador (migrate_v19 + carga del catálogo).
 */
require('dotenv').config();
const path = require('path');
const { pool } = require('../src/config/db');

(async () => {
  const data = require(path.resolve(__dirname, 'saldos_iniciales_2026.json'));
  const { meta, movimientos } = data;

  if (!meta.cuadra || Math.abs(meta.total_cargos - meta.total_abonos) >= 0.05) {
    console.error('ABORTA: la apertura no cuadra', meta.total_cargos, meta.total_abonos);
    process.exit(1);
  }

  // Verifica que todas las cuentas existan en el catálogo.
  const [cat] = await pool.query('SELECT codigo FROM sat_cuentas_agrupador');
  const set = new Set(cat.map((c) => c.codigo));
  const faltan = movimientos.filter((m) => !set.has(m.cuenta_codigo)).map((m) => m.cuenta_codigo);
  if (faltan.length) {
    console.error('ABORTA: cuentas no existen en sat_cuentas_agrupador:', faltan.join(', '));
    process.exit(1);
  }

  const mes = Number(meta.fecha_corte.slice(5, 7)); // mes del corte (enero = 1)
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [del] = await conn.query(
      "DELETE FROM polizas WHERE origen='apertura' AND periodo_anio=?", [meta.ejercicio]);

    const [res] = await conn.query(
      `INSERT INTO polizas
         (tipo, fecha, periodo_anio, periodo_mes, concepto, origen, referencia,
          total_cargos, total_abonos)
       VALUES ('diario', ?, ?, ?, ?, 'apertura', 'APERTURA', ?, ?)`,
      [meta.fecha_corte, meta.ejercicio, mes,
       `Saldos iniciales / apertura ${meta.ejercicio} (corte ${meta.fecha_corte})`,
       meta.total_cargos, meta.total_abonos]);
    const pid = res.insertId;

    const values = movimientos.map((m) =>
      [pid, m.cuenta_codigo, m.cargo, m.abono, m.nombre || null]);
    await conn.query(
      `INSERT INTO polizas_movimientos (poliza_id, cuenta_codigo, cargo, abono, concepto)
       VALUES ?`, [values]);

    await conn.commit();
    console.log(`Apertura cargada: póliza #${pid}, ${movimientos.length} cuentas, ` +
      `cargos ${meta.total_cargos} = abonos ${meta.total_abonos}. (borradas previas: ${del.affectedRows})`);
  } catch (e) {
    await conn.rollback();
    console.error('ERROR, rollback:', e.message);
    process.exit(1);
  } finally {
    conn.release();
  }
  process.exit(0);
})();
