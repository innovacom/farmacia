/**
 * pos.controller.js — Handlers HTTP del módulo POS Farmacia.
 * Toda query lleva empresa_id = req.empresaId (resuelto por middleware/tenant.js);
 * las lecturas por id pasan por getScoped (id ajeno ≡ 404).
 */
const { pool } = require('../../config/db');
const { getScoped } = require('./pos.tenant.helpers');
const turnos = require('./pos.turnos.service');
const ventas = require('./pos.ventas.service');
const posCfdi = require('./pos.cfdi.service');

// ── Sucursales ────────────────────────────────────────────────────────

async function listSucursales(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, a.nombre AS almacen_nombre, a.codigo AS almacen_codigo,
              (SELECT COUNT(*) FROM pos_cajas c WHERE c.sucursal_id = s.id AND c.activo = 1) AS cajas
       FROM sucursales s JOIN almacenes a ON a.id = s.almacen_id
       WHERE s.empresa_id = ? ORDER BY s.nombre`,
      [req.empresaId]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createSucursal(req, res, next) {
  try {
    const { almacen_id, codigo, nombre, direccion, telefono, responsable_usuario_id } = req.body;
    if (!almacen_id || !codigo?.trim() || !nombre?.trim()) {
      return res.status(400).json({ error: 'almacen_id, codigo y nombre requeridos' });
    }
    const [r] = await pool.query(
      `INSERT INTO sucursales (empresa_id, almacen_id, codigo, nombre, direccion, telefono, responsable_usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.empresaId, almacen_id, codigo.trim(), nombre.trim(),
       direccion || null, telefono || null, responsable_usuario_id || null]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese almacén ya tiene sucursal, o el código ya existe' });
    }
    next(err);
  }
}

async function updateSucursal(req, res, next) {
  try {
    await getScoped(pool, 'sucursales', req.params.id, req.empresaId);
    const sets = []; const vals = [];
    ['codigo', 'nombre', 'direccion', 'telefono', 'responsable_usuario_id', 'activo'].forEach((f) => {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(f === 'activo' ? (req.body[f] ? 1 : 0) : req.body[f]);
      }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id, req.empresaId);
    await pool.query(`UPDATE sucursales SET ${sets.join(', ')} WHERE id = ? AND empresa_id = ?`, vals);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese código ya existe' });
    next(err);
  }
}

// ── Cajas ─────────────────────────────────────────────────────────────

async function listCajas(req, res, next) {
  try {
    const params = [req.empresaId];
    let where = 'c.empresa_id = ?';
    if (req.query.sucursal_id) { where += ' AND c.sucursal_id = ?'; params.push(req.query.sucursal_id); }
    const [rows] = await pool.query(
      `SELECT c.*, s.nombre AS sucursal_nombre,
              (SELECT t.id FROM pos_turnos t WHERE t.caja_id = c.id AND t.estatus = 'abierto') AS turno_abierto_id
       FROM pos_cajas c JOIN sucursales s ON s.id = c.sucursal_id
       WHERE ${where} ORDER BY s.nombre, c.nombre`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createCaja(req, res, next) {
  try {
    const { sucursal_id, nombre } = req.body;
    if (!sucursal_id || !nombre?.trim()) {
      return res.status(400).json({ error: 'sucursal_id y nombre requeridos' });
    }
    await getScoped(pool, 'sucursales', sucursal_id, req.empresaId);
    const [r] = await pool.query(
      'INSERT INTO pos_cajas (empresa_id, sucursal_id, nombre) VALUES (?, ?, ?)',
      [req.empresaId, sucursal_id, nombre.trim()]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una caja con ese nombre en la sucursal' });
    next(err);
  }
}

async function updateCaja(req, res, next) {
  try {
    await getScoped(pool, 'pos_cajas', req.params.id, req.empresaId);
    const sets = []; const vals = [];
    ['nombre', 'activo'].forEach((f) => {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(f === 'activo' ? (req.body[f] ? 1 : 0) : req.body[f]);
      }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id, req.empresaId);
    await pool.query(`UPDATE pos_cajas SET ${sets.join(', ')} WHERE id = ? AND empresa_id = ?`, vals);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una caja con ese nombre en la sucursal' });
    next(err);
  }
}

// ── Turnos ────────────────────────────────────────────────────────────

async function turnoActual(req, res, next) {
  try {
    if (!req.query.caja_id) return res.status(400).json({ error: 'caja_id requerido' });
    const turno = await turnos.turnoActual(req.empresaId, req.query.caja_id);
    if (!turno) return res.status(404).json({ error: 'Sin turno abierto en esta caja' });
    res.json(turno);
  } catch (err) { next(err); }
}

async function abrirTurno(req, res, next) {
  try {
    const { caja_id, fondo_inicial } = req.body;
    const fondo = Number(fondo_inicial);
    if (!caja_id || !Number.isFinite(fondo) || fondo < 0) {
      return res.status(400).json({ error: 'caja_id y fondo_inicial (>= 0) requeridos' });
    }
    const r = await turnos.abrirTurno(req.empresaId, {
      caja_id, fondo_inicial: fondo, usuario_id: req.user.id,
    });
    res.status(201).json(r);
  } catch (err) { next(err); }
}

async function crearMovimiento(req, res, next) {
  try {
    const { tipo, monto, motivo } = req.body;
    const m = Number(monto);
    if (!['retiro', 'deposito'].includes(tipo) || !Number.isFinite(m) || m <= 0) {
      return res.status(400).json({ error: "tipo ('retiro'|'deposito') y monto (> 0) requeridos" });
    }
    const r = await turnos.registrarMovimiento(req.empresaId, req.params.id, {
      tipo, monto: m, motivo, usuario_id: req.user.id,
    });
    res.status(201).json(r);
  } catch (err) { next(err); }
}

async function corteTurno(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const c = await turnos.corte(conn, req.empresaId, req.params.id);
    const [movs] = await conn.query(
      `SELECT m.id, m.tipo, m.monto, m.motivo, m.created_at, u.nombre AS usuario
       FROM pos_caja_movimientos m JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.turno_id = ? AND m.empresa_id = ? ORDER BY m.created_at`,
      [req.params.id, req.empresaId]
    );
    res.json({ ...c, movimientos: movs });
  } catch (err) { next(err); }
  finally { conn.release(); }
}

async function cerrarTurno(req, res, next) {
  try {
    const contado = Number(req.body.efectivo_contado);
    if (!Number.isFinite(contado) || contado < 0) {
      return res.status(400).json({ error: 'efectivo_contado (>= 0) requerido' });
    }
    const r = await turnos.cerrarTurno(req.empresaId, req.params.id, {
      efectivo_contado: contado, notas: req.body.notas, usuario_id: req.user.id,
    });
    res.json(r);
  } catch (err) { next(err); }
}

async function listTurnos(req, res, next) {
  try {
    const params = [req.empresaId];
    let where = 't.empresa_id = ?';
    if (req.query.caja_id) { where += ' AND t.caja_id = ?'; params.push(req.query.caja_id); }
    if (req.query.estatus) { where += ' AND t.estatus = ?'; params.push(req.query.estatus); }
    const [rows] = await pool.query(
      `SELECT t.*, c.nombre AS caja, s.nombre AS sucursal, u.nombre AS cajero
       FROM pos_turnos t
       JOIN pos_cajas c ON c.id = t.caja_id
       JOIN sucursales s ON s.id = c.sucursal_id
       JOIN usuarios u ON u.id = t.usuario_id
       WHERE ${where}
       ORDER BY t.abierto_en DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

// ── Venta mostrador ───────────────────────────────────────────────────

async function buscarProductos(req, res, next) {
  try {
    const { q, sucursal_id } = req.query;
    if (!sucursal_id) return res.status(400).json({ error: 'sucursal_id requerido' });
    res.json(await ventas.buscarProductos(req.empresaId, { q, sucursal_id }));
  } catch (err) { next(err); }
}

async function crearVenta(req, res, next) {
  try {
    const { venta, repetida } = await ventas.crearVenta(req.empresaId, {
      ...req.body, usuario_id: req.user.id,
    });
    res.status(repetida ? 200 : 201).json(venta);
  } catch (err) {
    // 422 receta / 409 stock llevan datos extra para la UI
    if (err.status === 422) return res.status(422).json({ error: err.message, productos: err.productos });
    if (err.status === 409 && err.disponible !== undefined) {
      return res.status(409).json({ error: err.message, producto: err.producto, disponible: err.disponible });
    }
    next(err);
  }
}

async function listarVentas(req, res, next) {
  try {
    const { turno_id, desde, hasta } = req.query;
    res.json(await ventas.listarVentas(req.empresaId, { turno_id, desde, hasta }));
  } catch (err) { next(err); }
}

async function detalleVenta(req, res, next) {
  try {
    res.json(await ventas.detalleVenta(req.empresaId, req.params.id));
  } catch (err) { next(err); }
}

async function cancelarVenta(req, res, next) {
  try {
    res.json(await ventas.cancelarVenta(req.empresaId, req.params.id, {
      motivo: req.body?.motivo, usuario_id: req.user.id,
    }));
  } catch (err) { next(err); }
}

// ── Médicos (catálogo propio, COFEPRIS exige registrar, no verificar) ──

async function listMedicos(req, res, next) {
  try {
    const q = (req.query.q || '').trim();
    const params = [req.empresaId];
    let filtro = '';
    if (q) {
      filtro = ' AND (cedula_profesional LIKE ? OR nombre LIKE ?)';
      params.push(`${q}%`, `%${q}%`);
    }
    const [rows] = await pool.query(
      `SELECT id, nombre, cedula_profesional, especialidad, institucion, telefono, activo
       FROM medicos WHERE empresa_id = ? ${filtro} AND activo = 1
       ORDER BY nombre LIMIT 10`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createMedico(req, res, next) {
  try {
    const { nombre, cedula_profesional, especialidad, institucion, telefono } = req.body;
    if (!nombre?.trim() || !cedula_profesional?.trim()) {
      return res.status(400).json({ error: 'nombre y cedula_profesional requeridos' });
    }
    const [r] = await pool.query(
      `INSERT INTO medicos (empresa_id, nombre, cedula_profesional, especialidad, institucion, telefono)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.empresaId, nombre.trim(), cedula_profesional.trim(),
       especialidad || null, institucion || null, telefono || null]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un médico con esa cédula' });
    next(err);
  }
}

async function updateMedico(req, res, next) {
  try {
    await getScoped(pool, 'medicos', req.params.id, req.empresaId);
    const sets = []; const vals = [];
    ['nombre', 'cedula_profesional', 'especialidad', 'institucion', 'telefono', 'activo'].forEach((f) => {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(f === 'activo' ? (req.body[f] ? 1 : 0) : req.body[f]);
      }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id, req.empresaId);
    await pool.query(`UPDATE medicos SET ${sets.join(', ')} WHERE id = ? AND empresa_id = ?`, vals);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un médico con esa cédula' });
    next(err);
  }
}

// ── Bitácora COFEPRIS ─────────────────────────────────────────────────
// Vista de consulta (no tabla): partidas de controlados/antibióticos con
// receta, médico, paciente y LOTES del FEFO. Los snapshots por partida la
// hacen inmutable ante cambios de catálogo.

async function bitacora(req, res, next) {
  try {
    const { desde, hasta, clasificacion, sucursal_id } = req.query;
    const params = [req.empresaId];
    let where = `v.empresa_id = ? AND v.estatus = 'completada'
      AND pp.clasificacion_cofepris NOT IN ('libre', 'venta_farmacia')`;
    if (clasificacion) { where += ' AND pp.clasificacion_cofepris = ?'; params.push(clasificacion); }
    if (sucursal_id) { where += ' AND v.sucursal_id = ?'; params.push(sucursal_id); }
    if (desde) { where += ' AND v.created_at >= ?'; params.push(desde); }
    if (hasta) { where += ' AND v.created_at < DATE_ADD(?, INTERVAL 1 DAY)'; params.push(hasta); }
    const [rows] = await pool.query(
      `SELECT v.created_at AS fecha, v.folio AS ticket, s.nombre AS sucursal,
              pp.descripcion AS producto, p.sustancia_activa,
              pp.clasificacion_cofepris, pp.cantidad, pp.lotes_json,
              r.folio_receta, r.fecha_receta, r.paciente_nombre, r.paciente_domicilio,
              r.retenida, r.surtimiento,
              m.nombre AS medico, m.cedula_profesional,
              u.nombre AS dispenso
       FROM pos_ventas_partidas pp
       JOIN pos_ventas v ON v.id = pp.venta_id
       JOIN sucursales s ON s.id = v.sucursal_id
       JOIN productos p ON p.id = pp.producto_id
       JOIN usuarios u ON u.id = v.usuario_id
       LEFT JOIN pos_recetas r ON r.id = pp.receta_id
       LEFT JOIN medicos m ON m.id = r.medico_id
       WHERE ${where}
       ORDER BY v.created_at DESC
       LIMIT 2000`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

// ── CFDI del mostrador (Entrega 4) ────────────────────────────────────

async function facturarVenta(req, res, next) {
  try {
    res.status(201).json(await posCfdi.facturarVenta(
      req.empresaId, req.params.id, req.body?.receptor || {}, req.user.id
    ));
  } catch (err) {
    if (err.status === 422 && err.faltantes) {
      return res.status(422).json({ error: err.message, faltantes: err.faltantes });
    }
    next(err);
  }
}

async function crearFacturaGlobal(req, res, next) {
  try {
    const { periodicidad, desde, hasta, sucursal_id } = req.body;
    res.status(201).json(await posCfdi.crearFacturaGlobal(req.empresaId, {
      periodicidad, desde, hasta, sucursal_id: sucursal_id || null, usuario_id: req.user.id,
    }));
  } catch (err) { next(err); }
}

async function timbrarFacturaGlobal(req, res, next) {
  try {
    res.json(await posCfdi.timbrarFacturaGlobal(req.empresaId, req.params.id));
  } catch (err) { next(err); }
}

async function liberarFacturaGlobal(req, res, next) {
  try {
    res.json(await posCfdi.liberarTickets(req.empresaId, req.params.id));
  } catch (err) { next(err); }
}

async function listarFacturasGlobales(req, res, next) {
  try {
    res.json(await posCfdi.listarGlobales(req.empresaId));
  } catch (err) { next(err); }
}

module.exports = {
  listSucursales, createSucursal, updateSucursal,
  listCajas, createCaja, updateCaja,
  turnoActual, abrirTurno, crearMovimiento, corteTurno, cerrarTurno, listTurnos,
  buscarProductos, crearVenta, listarVentas, detalleVenta, cancelarVenta,
  listMedicos, createMedico, updateMedico, bitacora,
  facturarVenta, crearFacturaGlobal, timbrarFacturaGlobal, liberarFacturaGlobal, listarFacturasGlobales,
};
