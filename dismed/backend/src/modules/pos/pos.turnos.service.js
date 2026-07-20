/**
 * pos.turnos.service.js — Apertura/cierre de turno de caja, movimientos y corte.
 * Reglas:
 *  - Máximo un turno abierto por caja: candado transaccional (SELECT ... FOR UPDATE)
 *    + índice UNIQUE uq_turno_abierto (columna generada, ver migrate_v28.js).
 *  - La diferencia de arqueo se REGISTRA (contado - esperado), jamás se ajusta sola.
 *  - Arqueo ciego (migrate_v32): el cajero no ve `efectivo_esperado` mientras
 *    cuenta. Si el conteo no cuadra exacto, el cierre se rechaza y se cuenta
 *    el intento; al 3er fallo se exige autorizarSupervisor() antes de poder
 *    cerrar con diferencia. corte()/efectivo_esperado solo se exponen al
 *    front para rol=admin (ver pos.controller.js).
 * Todas las funciones reciben empresaId primero (convención del módulo pos).
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const { getScoped } = require('./pos.tenant.helpers');

const MAX_INTENTOS_CIERRE = 3;

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

/**
 * Cierra el turno con arqueo ciego. El llamador (controller) NUNCA debe
 * conocer efectivo_esperado antes de invocar esto.
 * Si el conteo no cuadra y el turno no está autorizado por un supervisor,
 * NO se cierra: se cuenta el intento y se devuelve { cerrado: false, ... }
 * sin revelar la cifra esperada. Al 3er fallo hay que pasar por
 * autorizarSupervisor() antes de poder reintentar con éxito.
 */
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
    const autorizado = !!turno.autorizado_por;

    if (diferencia !== 0 && !autorizado) {
      const intentos = turno.intentos_cierre + 1;
      await conn.query(`UPDATE pos_turnos SET intentos_cierre = ? WHERE id = ?`, [intentos, turnoId]);
      await conn.commit();
      const requiereSupervisor = intentos >= MAX_INTENTOS_CIERRE;
      return {
        cerrado: false,
        requiereSupervisor,
        intentos,
        intentosRestantes: Math.max(0, MAX_INTENTOS_CIERRE - intentos),
      };
    }

    await conn.query(
      `UPDATE pos_turnos
       SET estatus = 'cerrado', cerrado_en = NOW(), cerrado_por = ?,
           efectivo_esperado = ?, efectivo_contado = ?, tarjeta_total = ?,
           diferencia = ?, notas_cierre = ?
       WHERE id = ?`,
      [usuario_id, c.efectivo_esperado, contado, c.ventas_tarjeta, diferencia, notas || null, turnoId]
    );
    await conn.commit();
    return { ...c, cerrado: true, estatus: 'cerrado', efectivo_contado: contado, diferencia };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Autoriza el cierre de un turno bloqueado tras 3 conteos fallidos.
 * `clave` se compara contra clave_supervisor_hash de los admins activos de
 * la empresa (nunca contra su password de login). Al validar, marca el
 * turno como autorizado (permite cerrar aunque no cuadre) y devuelve el
 * corte COMPLETO —incluye efectivo_esperado— para que el cajero lo capture.
 */
async function autorizarSupervisor(empresaId, turnoId, { clave, usuario_id }) {
  const conn = await pool.getConnection();
  try {
    const turno = await getScoped(conn, 'pos_turnos', turnoId, empresaId);
    if (turno.estatus !== 'abierto') {
      const err = new Error('El turno ya está cerrado'); err.status = 409; throw err;
    }
    if (turno.intentos_cierre < MAX_INTENTOS_CIERRE) {
      const err = new Error('Aún no se requiere autorización de supervisor'); err.status = 400; throw err;
    }
    const [admins] = await conn.query(
      `SELECT id, clave_supervisor_hash FROM usuarios
       WHERE empresa_id = ? AND rol = 'admin' AND activo = 1 AND clave_supervisor_hash IS NOT NULL`,
      [empresaId]
    );
    let adminId = null;
    for (const a of admins) {
      if (await bcrypt.compare(clave || '', a.clave_supervisor_hash)) { adminId = a.id; break; }
    }
    if (!adminId) {
      const err = new Error('Clave de supervisor incorrecta'); err.status = 401; throw err;
    }
    await conn.query(
      `UPDATE pos_turnos SET autorizado_por = ?, autorizado_en = NOW() WHERE id = ?`,
      [adminId, turnoId]
    );
    const c = await corte(conn, empresaId, turnoId);
    return { ...c, autorizado: true };
  } finally {
    conn.release();
  }
}

module.exports = { turnoActual, abrirTurno, registrarMovimiento, corte, cerrarTurno, autorizarSupervisor };
