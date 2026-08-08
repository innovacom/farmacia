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
const reportes = require('./pos.reportes.service');
const citas = require('./pos.citas.service');
const whatsapp = require('../whatsapp/whatsapp.service');

// Reemplazo total de una tabla-hija tenant-scoped dependiente de un padre
// (DELETE de todas sus filas + reinsertar las nuevas dentro de una
// transacción) — mismo patrón detrás de "horarios de sucursal" y "horarios
// de médico": más simple que diffear fila por fila. `validarFila` corre
// ANTES de tocar la BD (así un dato inválido no deja la tabla vacía) y
// `filaValores` mapea cada elemento de `filas` a los valores del INSERT, en
// el mismo orden que `columnas`.
async function reemplazarFilasHijas(conn, {
  tablaPadre, idPadre, empresaId, tablaHija, columnaFk, columnas, filas, validarFila, filaValores,
}) {
  await conn.beginTransaction();
  try {
    await getScoped(conn, tablaPadre, idPadre, empresaId, { forUpdate: true });
    if (validarFila) filas.forEach(validarFila);
    await conn.query(`DELETE FROM ${tablaHija} WHERE ${columnaFk} = ?`, [idPadre]);
    for (const fila of filas) {
      await conn.query(
        `INSERT INTO ${tablaHija} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`,
        filaValores(fila)
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

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
    if (req.body.productos_favoritos !== undefined) {
      const HEX = /^#[0-9a-fA-F]{6}$/;
      const items = req.body.productos_favoritos;
      if (!Array.isArray(items) || items.length > 5 || !items.every((e) =>
        Number.isInteger(e?.id) && e.id > 0 && (e.color == null || HEX.test(e.color))
        && (e.presentacion_id == null || (Number.isInteger(e.presentacion_id) && e.presentacion_id > 0))
      )) {
        return res.status(400).json({ error: 'productos_favoritos: máximo 5 {id, color, presentacion_id?} válidos' });
      }
      const norm = items.map((e) => ({ id: e.id, color: e.color || null, presentacion_id: e.presentacion_id || null }));
      sets.push('productos_favoritos = ?');
      vals.push(norm.length ? JSON.stringify(norm) : null);
    }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id, req.empresaId);
    await pool.query(`UPDATE sucursales SET ${sets.join(', ')} WHERE id = ? AND empresa_id = ?`, vals);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese código ya existe' });
    next(err);
  }
}

// ── Horarios de sucursal (consulta del chatbot de WhatsApp) ────────────
// Reemplazo total por sucursal en cada guardado (más simple que diffear
// día por día); un día sin fila = "sin información" para el chatbot, no
// "cerrado" — evita que el bot invente un cierre que nadie configuró.

async function listHorariosSucursal(req, res, next) {
  try {
    await getScoped(pool, 'sucursales', req.params.id, req.empresaId);
    const [rows] = await pool.query(
      `SELECT dia_semana, hora_inicio, hora_fin, cerrado FROM sucursal_horarios
       WHERE sucursal_id = ? ORDER BY dia_semana`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function setHorariosSucursal(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const dias = Array.isArray(req.body.dias) ? req.body.dias : [];
    await reemplazarFilasHijas(conn, {
      tablaPadre: 'sucursales', idPadre: req.params.id, empresaId: req.empresaId,
      tablaHija: 'sucursal_horarios', columnaFk: 'sucursal_id',
      columnas: ['empresa_id', 'sucursal_id', 'dia_semana', 'hora_inicio', 'hora_fin', 'cerrado'],
      filas: dias,
      validarFila: (d) => {
        if (!Number.isInteger(d.dia_semana) || d.dia_semana < 1 || d.dia_semana > 7) {
          throw Object.assign(new Error('dia_semana inválido (1-7)'), { status: 400 });
        }
      },
      filaValores: (d) => [req.empresaId, req.params.id, d.dia_semana,
        d.cerrado ? null : (d.hora_inicio || null), d.cerrado ? null : (d.hora_fin || null), d.cerrado ? 1 : 0],
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    conn.release();
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
    // Arqueo ciego: fondo_inicial es un componente del cálculo del esperado,
    // así que también se oculta al cajero (ver ocultarCorte más abajo).
    if (req.user.rol !== 'admin') {
      const { fondo_inicial, ...resto } = turno;
      return res.json(resto);
    }
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

// Arqueo ciego (migrate_v32): NINGÚN componente del cálculo del esperado
// (fondo, ventas en efectivo, cambio, depósitos, retiros) se expone al
// cajero mientras el turno está abierto — no solo el total, porque con las
// partes también se puede reconstruir la suma. Solo rol=admin ve el corte
// completo. El cajero ve "***" en el front hasta que un supervisor autoriza
// el cierre tras 3 intentos fallidos (ver cerrarTurno/autorizarSupervisor).
function ocultarCorte(c, req) {
  if (req.user.rol === 'admin') return c;
  return { turno_id: c.turno_id, estatus: c.estatus, ventas_tarjeta: c.ventas_tarjeta };
}

async function corteTurno(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const c = await turnos.corte(conn, req.empresaId, req.params.id);
    if (req.user.rol !== 'admin') {
      // Los movimientos (retiros/depósitos) también son insumo del cálculo;
      // se ocultan junto con el resto del desglose.
      return res.json(ocultarCorte(c, req));
    }
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
    // Si no cerró (no cuadró el arqueo), nunca se revela efectivo_esperado.
    res.json(r.cerrado ? r : { cerrado: false, requiereSupervisor: r.requiereSupervisor, intentosRestantes: r.intentosRestantes });
  } catch (err) { next(err); }
}

async function autorizarSupervisorCierre(req, res, next) {
  try {
    const r = await turnos.autorizarSupervisor(req.empresaId, req.params.id, {
      clave: req.body.clave, usuario_id: req.user.id,
    });
    res.json(r);
  } catch (err) { next(err); }
}

// Desglose de un turno (abierto o cerrado) SOLO para rol=admin: fondo
// inicial, ventas, cambio, depósitos/retiros y esperado — el historial
// normal de cajero solo trae esperado/contado/diferencia del turno cerrado.
async function desgloseTurno(req, res, next) {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  const conn = await pool.getConnection();
  try {
    const c = await turnos.corte(conn, req.empresaId, req.params.id);
    const [movs] = await conn.query(
      `SELECT m.id, m.tipo, m.monto, m.motivo, m.created_at, u.nombre AS usuario
       FROM pos_caja_movimientos m JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.turno_id = ? AND m.empresa_id = ? ORDER BY m.created_at`,
      [req.params.id, req.empresaId]
    );
    const [[t]] = await conn.query(
      `SELECT tu.efectivo_contado, tu.diferencia, tu.cerrado_en, tu.notas_cierre,
              cierre.nombre AS cerrado_por, autoriza.nombre AS autorizado_por
       FROM pos_turnos tu
       LEFT JOIN usuarios cierre  ON cierre.id  = tu.cerrado_por
       LEFT JOIN usuarios autoriza ON autoriza.id = tu.autorizado_por
       WHERE tu.id = ? AND tu.empresa_id = ?`,
      [req.params.id, req.empresaId]
    );
    res.json({ ...c, ...t, movimientos: movs });
  } catch (err) { next(err); }
  finally { conn.release(); }
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
    const { q, sucursal_id, cliente_fidelidad_id } = req.query;
    if (!sucursal_id) return res.status(400).json({ error: 'sucursal_id requerido' });
    res.json(await ventas.buscarProductos(req.empresaId, { q, sucursal_id, cliente_fidelidad_id }));
  } catch (err) { next(err); }
}

async function favoritosProductos(req, res, next) {
  try {
    const { sucursal_id, cliente_fidelidad_id } = req.query;
    if (!sucursal_id) return res.status(400).json({ error: 'sucursal_id requerido' });
    res.json(await ventas.favoritos(req.empresaId, { sucursal_id, cliente_fidelidad_id }));
  } catch (err) { next(err); }
}

async function registrarExistencia(req, res, next) {
  try {
    const { sucursal_id, presentacion_id, cantidad, costo_unitario, numero_lote, fecha_caducidad } = req.body;
    if (!sucursal_id) return res.status(400).json({ error: 'sucursal_id requerido' });
    const r = await ventas.registrarExistencia(req.empresaId, {
      sucursal_id, producto_id: req.params.id, presentacion_id, cantidad,
      costo_unitario, numero_lote, fecha_caducidad, usuario_id: req.user.id,
    });
    res.status(201).json(r);
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
    const admin = req.query.admin === '1';
    const q = (req.query.q || '').trim();
    const params = [req.empresaId];
    let filtro = '';
    if (q) {
      filtro = ' AND (cedula_profesional LIKE ? OR nombre LIKE ?)';
      params.push(`${q}%`, `%${q}%`);
    }
    const [rows] = await pool.query(
      `SELECT id, nombre, cedula_profesional, registro_ssa, especialidad, institucion, telefono, activo
       FROM medicos WHERE empresa_id = ? ${filtro} ${admin ? '' : 'AND activo = 1'}
       ORDER BY nombre ${admin ? '' : 'LIMIT 10'}`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createMedico(req, res, next) {
  try {
    const { nombre, cedula_profesional, registro_ssa, especialidad, institucion, telefono } = req.body;
    if (!nombre?.trim() || !cedula_profesional?.trim()) {
      return res.status(400).json({ error: 'nombre y cedula_profesional requeridos' });
    }
    const [r] = await pool.query(
      `INSERT INTO medicos (empresa_id, nombre, cedula_profesional, registro_ssa, especialidad, institucion, telefono)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.empresaId, nombre.trim(), cedula_profesional.trim(),
       registro_ssa || null, especialidad || null, institucion || null, telefono || null]
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
    ['nombre', 'cedula_profesional', 'registro_ssa', 'especialidad', 'institucion', 'telefono', 'activo'].forEach((f) => {
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

// ── Horarios de médico (consulta del chatbot de WhatsApp: "quién está en
// turno ahora") — informativo, no liga con pos_citas (ver migrate_v37: las
// citas no distinguen médico). Varias filas por día son válidas (turno
// matutino + vespertino), por eso es lista de turnos, no un solo rango.

async function listHorariosMedico(req, res, next) {
  try {
    await getScoped(pool, 'medicos', req.params.id, req.empresaId);
    const [rows] = await pool.query(
      `SELECT id, dia_semana, hora_inicio, hora_fin FROM medico_horarios
       WHERE medico_id = ? ORDER BY dia_semana, hora_inicio`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function setHorariosMedico(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const turnosBody = Array.isArray(req.body.turnos) ? req.body.turnos : [];
    await reemplazarFilasHijas(conn, {
      tablaPadre: 'medicos', idPadre: req.params.id, empresaId: req.empresaId,
      tablaHija: 'medico_horarios', columnaFk: 'medico_id',
      columnas: ['empresa_id', 'medico_id', 'dia_semana', 'hora_inicio', 'hora_fin'],
      filas: turnosBody,
      validarFila: (t) => {
        if (!Number.isInteger(t.dia_semana) || t.dia_semana < 1 || t.dia_semana > 7 || !t.hora_inicio || !t.hora_fin) {
          throw Object.assign(new Error('Cada turno requiere dia_semana (1-7), hora_inicio y hora_fin'), { status: 400 });
        }
      },
      filaValores: (t) => [req.empresaId, req.params.id, t.dia_semana, t.hora_inicio, t.hora_fin],
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    conn.release();
  }
}

// ── Citas médicas (agenda del mostrador) ────────────────────────────────
// No importa qué médico esté de guardia: solo se aparta horario + paciente.
// El cobro reusa la venta normal de mostrador (ver VentaMostrador.jsx con
// ?cita_id=); pagarCita solo liga la venta ya creada.

async function listServiciosCitas(req, res, next) {
  try {
    res.json(await citas.listarServicios());
  } catch (err) { next(err); }
}

async function listCitas(req, res, next) {
  try {
    const { sucursal_id, desde, hasta, estatus } = req.query;
    res.json(await citas.listarCitas(req.empresaId, { sucursal_id, desde, hasta, estatus }));
  } catch (err) { next(err); }
}

async function detalleCita(req, res, next) {
  try {
    res.json(await citas.detalleCita(req.empresaId, req.params.id));
  } catch (err) { next(err); }
}

async function crearCita(req, res, next) {
  try {
    res.status(201).json(await citas.crearCita(req.empresaId, { ...req.body, usuario_id: req.user.id }));
  } catch (err) { next(err); }
}

async function updateCita(req, res, next) {
  try {
    res.json(await citas.updateCita(req.empresaId, req.params.id, req.body));
  } catch (err) { next(err); }
}

async function cancelarCita(req, res, next) {
  try {
    res.json(await citas.cancelarCita(req.empresaId, req.params.id, {
      motivo: req.body?.motivo, usuario_id: req.user.id,
    }));
  } catch (err) { next(err); }
}

async function pagarCita(req, res, next) {
  try {
    if (!req.body?.venta_id) return res.status(400).json({ error: 'venta_id requerido' });
    res.json(await citas.marcarPagada(req.empresaId, req.params.id, { venta_id: req.body.venta_id }));
  } catch (err) { next(err); }
}

async function citasPendientesConfirmar(req, res, next) {
  try {
    if (!req.query.sucursal_id) return res.status(400).json({ error: 'sucursal_id requerido' });
    res.json(await citas.pendientesConfirmar(req.empresaId, req.query.sucursal_id));
  } catch (err) { next(err); }
}

async function confirmarCita(req, res, next) {
  try {
    res.json(await citas.confirmarCita(req.empresaId, req.params.id, { usuario_id: req.user.id }));
  } catch (err) { next(err); }
}

async function recordatorioWhatsappCita(req, res, next) {
  try {
    res.json(await whatsapp.enviarRecordatorioCita(req.empresaId, req.params.id, { usuario_id: req.user.id }));
  } catch (err) { next(err); }
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

// ── Dashboard / Reportes ────────────────────────────────────────────────
// Grupo A (pos-reportes) y Grupo B — ganancias (pos-reportes-ganancias, ver
// pos.routes.js): la separación de permiso vive en las rutas, aquí solo se
// delega al servicio con los filtros de query string.

async function reporteResumen(req, res, next) {
  try { res.json(await reportes.resumenVentas(req.empresaId, req.query)); }
  catch (err) { next(err); }
}
async function reporteVentasSucursal(req, res, next) {
  try { res.json(await reportes.ventasPorSucursal(req.empresaId, req.query)); }
  catch (err) { next(err); }
}
async function reporteTopProductos(req, res, next) {
  try { res.json(await reportes.topProductos(req.empresaId, req.query)); }
  catch (err) { next(err); }
}
async function reporteFormasPago(req, res, next) {
  try { res.json(await reportes.formasPago(req.empresaId, req.query)); }
  catch (err) { next(err); }
}
async function reporteExistencias(req, res, next) {
  try { res.json(await reportes.existencias(req.empresaId, req.query)); }
  catch (err) { next(err); }
}
async function reporteRecetas(req, res, next) {
  try { res.json(await reportes.recetasCofepris(req.empresaId, req.query)); }
  catch (err) { next(err); }
}
async function reporteGanancias(req, res, next) {
  try { res.json(await reportes.ganancias(req.empresaId, req.query)); }
  catch (err) { next(err); }
}
async function reporteGananciasProductos(req, res, next) {
  try { res.json(await reportes.gananciasPorProducto(req.empresaId, req.query)); }
  catch (err) { next(err); }
}
async function reportePreciosModificados(req, res, next) {
  try { res.json(await reportes.preciosModificados(req.empresaId, req.query)); }
  catch (err) { next(err); }
}

module.exports = {
  listSucursales, createSucursal, updateSucursal,
  listHorariosSucursal, setHorariosSucursal,
  listCajas, createCaja, updateCaja,
  turnoActual, abrirTurno, crearMovimiento, corteTurno, cerrarTurno, listTurnos,
  autorizarSupervisorCierre, desgloseTurno,
  buscarProductos, favoritosProductos, registrarExistencia, crearVenta, listarVentas, detalleVenta, cancelarVenta,
  listMedicos, createMedico, updateMedico, bitacora,
  listHorariosMedico, setHorariosMedico,
  listServiciosCitas, listCitas, detalleCita, crearCita, updateCita, cancelarCita, pagarCita,
  citasPendientesConfirmar, confirmarCita, recordatorioWhatsappCita,
  facturarVenta, crearFacturaGlobal, timbrarFacturaGlobal, liberarFacturaGlobal, listarFacturasGlobales,
  reporteResumen, reporteVentasSucursal, reporteTopProductos, reporteFormasPago,
  reporteExistencias, reporteRecetas, reporteGanancias, reporteGananciasProductos,
  reportePreciosModificados,
};
