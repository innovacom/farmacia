/**
 * pos.turnos.service.js — Apertura/cierre de turno de caja, movimientos y corte.
 * Reglas:
 *  - Máximo un turno abierto por caja: candado transaccional (SELECT ... FOR UPDATE)
 *    + índice UNIQUE uq_turno_abierto (columna generada, ver migrate_v28.js).
 *  - La diferencia de arqueo se REGISTRA (contado - esperado), jamás se ajusta sola.
 * Todas las funciones reciben empresaId primero (convención del módulo pos).
 */
const { pool } = require('../../config/db');
const { getScoped } = require('./pos.tenant.helpers');

/** Turno abierto de una caja (o null). Valida que la caja sea del tenant. */
async function turnoActual(empresaId, cajaId) {
  const conn = await pool.getConnection();
  try {
    await getScoped(conn, 'pos_cajas', cajaId, empresaId);
    const [rows] = await conn.query(
      `SELECT t.*, u.nombre AS cajero
       FROM pos_turnos t JOIN usuarios u ON u.id = t.usuario_id
       WHERE t.caja_id = ? AND t.empresa_id = ? AND t.estatus = 'abierto'`,
      [cajaId, empresaId]
    );
    return rows[0] || null;
  } finally {
    conn.release();
  }
}

async function abrirTurno(empresaId, { caja_id, fondo_inicial, usuario_id }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const caja = await getScoped(conn, 'pos_cajas', caja_id, empresaId, { forUpdate: true });
    if (!caja.activo) {
      const err = new Error('La caja está inactiva'); err.status = 400; throw err;
    }
    const [abiertos] = await conn.query(
      `SELECT id FROM pos_turnos WHERE caja_id = ? AND estatus = 'abierto' FOR UPDATE`,
      [caja_id]
    );
    if (abiertos.length) {
      const err = new Error('Ya hay un turno abierto en esta caja'); err.status = 409; throw err;
    }
    const [r] = await conn.query(
      `INSERT INTO pos_turnos (empresa_id, caja_id, usuario_id, fondo_inicial)
       VALUES (?, ?, ?, ?)`,
      [empresaId, caja_id, usuario_id, fondo_inicial]
    );
    await conn.commit();
    return { id: r.insertId };
  } catch (err) {
    await conn.rollback();
    // El UNIQUE es el segundo candado ante una carrera que se cuele
    if (err.code === 'ER_DUP_ENTRY') {
      const e = new Error('Ya hay un turno abierto en esta caja'); e.status = 409; throw e;
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function registrarMovimiento(empresaId, turnoId, { tipo, monto, motivo, usuario_id }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const turno = await getScoped(conn, 'pos_turnos', turnoId, empresaId, { forUpdate: true });
    if (turno.estatus !== 'abierto') {
      const err = new Error('El turno ya está cerrado'); err.status = 409; throw err;
    }
    const [r] = await conn.query(
      `INSERT INTO pos_caja_movimientos (empresa_id, turno_id, tipo, monto, motivo, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [empresaId, turnoId, tipo, monto, motivo || null, usuario_id]
    );
    await conn.commit();
    return { id: r.insertId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Corte (pre-cierre) de un turno:
 * esperado = fondo + ventas en efectivo - cambio entregado + depósitos - retiros.
 * Solo cuentan ventas 'completada' (las canceladas reingresaron).
 */
async function corte(conn, empresaId, turnoId) {
  const turno = await getScoped(conn, 'pos_turnos', turnoId, empresaId);
  const [[ventas]] = await conn.query(
    `SELECT COUNT(*) AS num_ventas,
            COALESCE(SUM(pago_efectivo), 0) AS efectivo,
            COALESCE(SUM(cambio), 0)        AS cambio,
            COALESCE(SUM(pago_tarjeta), 0)  AS tarjeta,
            COALESCE(SUM(total), 0)         AS total_vendido
     FROM pos_ventas
     WHERE turno_id = ? AND empresa_id = ? AND estatus = 'completada'`,
    [turnoId, empresaId]
  );
  const [[movs]] = await conn.query(
    `SELECT COALESCE(SUM(IF(tipo = 'deposito', monto, 0)), 0) AS depositos,
            COALESCE(SUM(IF(tipo = 'retiro', monto, 0)), 0)   AS retiros
     FROM pos_caja_movimientos WHERE turno_id = ? AND empresa_id = ?`,
    [turnoId, empresaId]
  );
  const efectivoEsperado =
    Number(turno.fondo_inicial) + Number(ventas.efectivo) - Number(ventas.cambio) +
    Number(movs.depositos) - Number(movs.retiros);

  return {
    turno_id: turno.id,
    estatus: turno.estatus,
    fondo_inicial: Number(turno.fondo_inicial),
    num_ventas: ventas.num_ventas,
    total_vendido: Number(ventas.total_vendido),
    ventas_efectivo: Number(ventas.efectivo),
    cambio_entregado: Number(ventas.cambio),
    ventas_tarjeta: Number(ventas.tarjeta),
    depositos: Number(movs.depositos),
    retiros: Number(movs.retiros),
    efectivo_esperado: Math.round(efectivoEsperado * 100) / 100,
  };
}

async function cerrarTurno(empresaId, turnoId, { efectivo_contado, notas, usuario_id }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const turno = await getScoped(conn, 'pos_turnos', turnoId, empresaId, { forUpdate: true });
    if (turno.estatus !== 'abierto') {
      const err = new Error('El turno ya está cerrado'); err.status = 409; throw err;
    }
    const c = await corte(conn, empresaId, turnoId);
    const contado = Number(efectivo_contado);
    const diferencia = Math.round((contado - c.efectivo_esperado) * 100) / 100;
    await conn.query(
      `UPDATE pos_turnos
       SET estatus = 'cerrado', cerrado_en = NOW(), cerrado_por = ?,
           efectivo_esperado = ?, efectivo_contado = ?, tarjeta_total = ?,
           diferencia = ?, notas_cierre = ?
       WHERE id = ?`,
      [usuario_id, c.efectivo_esperado, contado, c.ventas_tarjeta, diferencia, notas || null, turnoId]
    );
    await conn.commit();
    return { ...c, estatus: 'cerrado', efectivo_contado: contado, diferencia };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { turnoActual, abrirTurno, registrarMovimiento, corte, cerrarTurno };
