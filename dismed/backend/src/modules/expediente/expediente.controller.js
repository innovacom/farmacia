const { pool } = require('../../config/db');
const { getScoped } = require('../pos/pos.tenant.helpers');
const ventas = require('../pos/pos.ventas.service');
const { generarPdfReceta } = require('./receta.pdf.generator');
const { urlFirmada } = require('../../services/outputUrl.service');

// ── Turnos de consultorio (médico + sucursal, sin arqueo) ───────────────────

async function listTurnosAbiertos(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT t.*, m.nombre AS medico_nombre, m.cedula_profesional, s.nombre AS sucursal_nombre
       FROM expediente_turnos t
       JOIN medicos m ON m.id = t.medico_id
       JOIN sucursales s ON s.id = t.sucursal_id
       WHERE t.empresa_id = ? AND t.estatus = 'abierto'
       ORDER BY t.abierto_en DESC`,
      [req.empresaId]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function abrirTurno(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { medico_id, sucursal_id } = req.body;
    if (!medico_id || !sucursal_id) {
      conn.release();
      return res.status(400).json({ error: 'medico_id y sucursal_id son requeridos' });
    }
    await conn.beginTransaction();
    const medico = await getScoped(conn, 'medicos', medico_id, req.empresaId, { forUpdate: true });
    if (!medico.activo) {
      const e = new Error('El médico no está activo'); e.status = 400; throw e;
    }
    await getScoped(conn, 'sucursales', sucursal_id, req.empresaId);

    const [abiertos] = await conn.query(
      `SELECT id FROM expediente_turnos WHERE medico_id = ? AND estatus = 'abierto' FOR UPDATE`,
      [medico_id]
    );
    if (abiertos.length) {
      const e = new Error('Este médico ya tiene un turno abierto'); e.status = 409; throw e;
    }

    const [r] = await conn.query(
      `INSERT INTO expediente_turnos (empresa_id, medico_id, sucursal_id, usuario_id)
       VALUES (?, ?, ?, ?)`,
      [req.empresaId, medico_id, sucursal_id, req.user.id]
    );
    await conn.commit();
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Este médico ya tiene un turno abierto' });
    }
    next(err);
  } finally {
    conn.release();
  }
}

async function cerrarTurno(req, res, next) {
  try {
    await getScoped(pool, 'expediente_turnos', req.params.id, req.empresaId);
    await pool.query(
      `UPDATE expediente_turnos SET estatus = 'cerrado', cerrado_en = NOW()
       WHERE id = ? AND empresa_id = ? AND estatus = 'abierto'`,
      [req.params.id, req.empresaId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Resuelve un turno abierto propio de la empresa; usado para derivar
// medico_id/sucursal_id al registrar pacientes, consultas y recetas.
async function turnoAbiertoOrThrow(conn, turnoId, empresaId) {
  const [[turno]] = await conn.query(
    `SELECT * FROM expediente_turnos WHERE id = ? AND empresa_id = ? AND estatus = 'abierto'`,
    [turnoId, empresaId]
  );
  if (!turno) {
    const e = new Error('El turno indicado no existe o ya está cerrado'); e.status = 400; throw e;
  }
  return turno;
}

// ── Medicamentos disponibles en la sucursal del turno ───────────────────────

async function buscarMedicamentos(req, res, next) {
  try {
    const { turno_id, q } = req.query;
    if (!turno_id) return res.status(400).json({ error: 'turno_id requerido' });
    const turno = await turnoAbiertoOrThrow(pool, turno_id, req.empresaId);
    const productos = await ventas.buscarProductos(req.empresaId, { q, sucursal_id: turno.sucursal_id });
    res.json(productos);
  } catch (err) { next(err); }
}

// ── Pacientes ────────────────────────────────────────────────────────────────

async function listPacientes(req, res, next) {
  try {
    const { q } = req.query;
    const soloActivos = req.query.activos === '1';
    const where = ['p.empresa_id = ?'];
    const vals = [req.empresaId];
    if (soloActivos) where.push('p.activo = 1');
    if (q) {
      where.push('(p.nombre LIKE ? OR p.apellido_paterno LIKE ? OR p.apellido_materno LIKE ? OR p.curp LIKE ?)');
      const t = `%${q}%`;
      vals.push(t, t, t, t);
    }
    const [rows] = await pool.query(
      `SELECT p.*, m.nombre AS medico_nombre
       FROM pacientes p
       LEFT JOIN medicos m ON m.id = p.medico_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.nombre, p.apellido_paterno`,
      vals
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getPaciente(req, res, next) {
  try {
    const [[paciente]] = await pool.query(
      `SELECT p.*, m.nombre AS medico_nombre
       FROM pacientes p LEFT JOIN medicos m ON m.id = p.medico_id
       WHERE p.id = ? AND p.empresa_id = ?`, [req.params.id, req.empresaId]
    );
    if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado' });

    const [[antecedentes]] = await pool.query(
      'SELECT * FROM expedientes_clinicos WHERE paciente_id = ?', [req.params.id]
    );
    res.json({ ...paciente, antecedentes: antecedentes || null });
  } catch (err) { next(err); }
}

async function createPaciente(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      turno_id, nombre, apellido_paterno, apellido_materno, fecha_nacimiento, sexo,
      curp, telefono, email, direccion, tipo_sangre, alergias,
      contacto_emergencia_nombre, contacto_emergencia_telefono,
    } = req.body;

    if (!turno_id || !nombre) {
      conn.release();
      return res.status(400).json({ error: 'turno_id (médico en servicio) y nombre son requeridos' });
    }
    const turno = await turnoAbiertoOrThrow(conn, turno_id, req.empresaId);

    const [result] = await conn.query(
      `INSERT INTO pacientes
        (empresa_id, medico_id, nombre, apellido_paterno, apellido_materno, fecha_nacimiento, sexo,
         curp, telefono, email, direccion, tipo_sangre, alergias,
         contacto_emergencia_nombre, contacto_emergencia_telefono)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.empresaId, turno.medico_id, nombre, apellido_paterno || null, apellido_materno || null,
       fecha_nacimiento || null, sexo || 'X', curp || null, telefono || null, email || null,
       direccion || null, tipo_sangre || null, alergias || null,
       contacto_emergencia_nombre || null, contacto_emergencia_telefono || null]
    );
    res.status(201).json({ id: result.insertId, nombre });
  } catch (err) { next(err); }
  finally { conn.release(); }
}

async function updatePaciente(req, res, next) {
  try {
    await getScoped(pool, 'pacientes', req.params.id, req.empresaId);
    const fields = [
      'nombre', 'apellido_paterno', 'apellido_materno', 'fecha_nacimiento', 'sexo',
      'curp', 'telefono', 'email', 'direccion', 'tipo_sangre', 'alergias',
      'contacto_emergencia_nombre', 'contacto_emergencia_telefono', 'activo',
    ];
    const sets = []; const vals = [];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
    vals.push(req.params.id, req.empresaId);
    await pool.query(`UPDATE pacientes SET ${sets.join(', ')} WHERE id = ? AND empresa_id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function removePaciente(req, res, next) {
  try {
    await getScoped(pool, 'pacientes', req.params.id, req.empresaId);
    await pool.query('UPDATE pacientes SET activo = 0 WHERE id = ? AND empresa_id = ?', [req.params.id, req.empresaId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Antecedentes (NOM-004) ───────────────────────────────────────────────────

async function upsertAntecedentes(req, res, next) {
  try {
    await getScoped(pool, 'pacientes', req.params.id, req.empresaId);
    const {
      antecedentes_heredofamiliares,
      antecedentes_personales_no_patologicos,
      antecedentes_personales_patologicos,
    } = req.body;

    await pool.query(
      `INSERT INTO expedientes_clinicos
        (paciente_id, antecedentes_heredofamiliares, antecedentes_personales_no_patologicos,
         antecedentes_personales_patologicos, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         antecedentes_heredofamiliares = VALUES(antecedentes_heredofamiliares),
         antecedentes_personales_no_patologicos = VALUES(antecedentes_personales_no_patologicos),
         antecedentes_personales_patologicos = VALUES(antecedentes_personales_patologicos),
         updated_by = VALUES(updated_by)`,
      [req.params.id, antecedentes_heredofamiliares || null,
       antecedentes_personales_no_patologicos || null, antecedentes_personales_patologicos || null,
       req.user.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Consultas (notas de evolución, inmutables) ──────────────────────────────

async function listConsultas(req, res, next) {
  try {
    await getScoped(pool, 'pacientes', req.params.id, req.empresaId);
    const [rows] = await pool.query(
      `SELECT c.*, s.nombre AS sucursal_nombre
       FROM consultas_medicas c
       LEFT JOIN expediente_turnos t ON t.id = c.turno_id
       LEFT JOIN sucursales s ON s.id = t.sucursal_id
       WHERE c.paciente_id = ? AND c.empresa_id = ?
       ORDER BY c.fecha_hora DESC`,
      [req.params.id, req.empresaId]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createConsulta(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await getScoped(conn, 'pacientes', req.params.id, req.empresaId);
    const {
      turno_id, fecha_hora, motivo_consulta, padecimiento_actual, exploracion_fisica,
      signos_vitales, diagnostico, plan_tratamiento, pronostico,
    } = req.body;
    if (!turno_id) { conn.release(); return res.status(400).json({ error: 'turno_id (médico en servicio) requerido' }); }
    const turno = await turnoAbiertoOrThrow(conn, turno_id, req.empresaId);
    const [[medico]] = await conn.query('SELECT nombre, cedula_profesional FROM medicos WHERE id = ?', [turno.medico_id]);

    const [result] = await conn.query(
      `INSERT INTO consultas_medicas
        (empresa_id, paciente_id, turno_id, fecha_hora, motivo_consulta, padecimiento_actual, exploracion_fisica,
         signos_vitales, diagnostico, plan_tratamiento, pronostico, medico_id, medico_nombre, medico_cedula)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.empresaId, req.params.id, turno_id, fecha_hora || new Date(), motivo_consulta || null,
       padecimiento_actual || null, exploracion_fisica || null,
       signos_vitales ? JSON.stringify(signos_vitales) : null,
       diagnostico || null, plan_tratamiento || null, pronostico || null,
       turno.medico_id, medico.nombre, medico.cedula_profesional]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) { next(err); }
  finally { conn.release(); }
}

// ── Recetas electrónicas ─────────────────────────────────────────────────────

async function listRecetas(req, res, next) {
  try {
    await getScoped(pool, 'pacientes', req.params.id, req.empresaId);
    const [rows] = await pool.query(
      `SELECT r.* FROM recetas_medicas r WHERE r.paciente_id = ? AND r.empresa_id = ? ORDER BY r.fecha DESC`,
      [req.params.id, req.empresaId]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getReceta(req, res, next) {
  try {
    const receta = await getScoped(pool, 'recetas_medicas', req.params.id, req.empresaId);
    const [partidas] = await pool.query(
      `SELECT rp.*, p.sku_interno
       FROM recetas_medicas_partidas rp
       LEFT JOIN productos p ON p.id = rp.producto_id
       WHERE rp.receta_id = ? ORDER BY rp.linea`,
      [req.params.id]
    );
    res.json({ ...receta, partidas });
  } catch (err) { next(err); }
}

async function createReceta(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await getScoped(conn, 'pacientes', req.params.id, req.empresaId);
    const { turno_id, medico_id, consulta_id, indicaciones_generales, vigencia_dias, partidas } = req.body;
    if (!turno_id) { conn.release(); return res.status(400).json({ error: 'turno_id requerido (define la sucursal/almacén)' }); }
    if (!medico_id) { conn.release(); return res.status(400).json({ error: 'medico_id requerido (quién expide la receta)' }); }
    if (!Array.isArray(partidas) || !partidas.length) {
      conn.release();
      return res.status(400).json({ error: 'La receta requiere al menos una partida' });
    }

    await conn.beginTransaction();
    await turnoAbiertoOrThrow(conn, turno_id, req.empresaId);
    const medico = await getScoped(conn, 'medicos', medico_id, req.empresaId);

    await conn.query('CALL sp_generar_folio(?, @folio)', ['REC']);
    const [[{ folio }]] = await conn.query('SELECT @folio AS folio');

    const [r] = await conn.query(
      `INSERT INTO recetas_medicas
        (empresa_id, folio, paciente_id, turno_id, consulta_id, medico_id, medico_nombre, medico_cedula,
         indicaciones_generales, vigencia_dias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.empresaId, folio, req.params.id, turno_id, consulta_id || null,
       medico.id, medico.nombre, medico.cedula_profesional,
       indicaciones_generales || null, vigencia_dias || 30]
    );

    let linea = 1;
    for (const p of partidas) {
      if (!p.medicamento_nombre) continue;
      await conn.query(
        `INSERT INTO recetas_medicas_partidas
          (receta_id, linea, producto_id, medicamento_nombre, presentacion, dosis,
           via_administracion, frecuencia, duracion, cantidad, indicaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.insertId, linea++, p.producto_id || null, p.medicamento_nombre,
         p.presentacion || null, p.dosis || null, p.via_administracion || null,
         p.frecuencia || null, p.duracion || null, p.cantidad || 1, p.indicaciones || null]
      );
    }

    await conn.commit();
    res.status(201).json({ id: r.insertId, folio });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function generarRecetaPdf(req, res, next) {
  try {
    const receta = await getScoped(pool, 'recetas_medicas', req.params.id, req.empresaId);

    const [[datos]] = await pool.query(
      `SELECT p.nombre AS paciente_nombre, p.apellido_paterno AS paciente_apellido_paterno,
              p.apellido_materno AS paciente_apellido_materno, p.fecha_nacimiento AS paciente_fecha_nacimiento,
              m.cedula_profesional AS medico_cedula, m.registro_ssa AS medico_registro_ssa,
              m.especialidad AS medico_especialidad, m.institucion AS medico_institucion,
              m.telefono AS medico_telefono,
              s.direccion AS sucursal_direccion, c.signos_vitales
       FROM recetas_medicas r
       JOIN pacientes p ON p.id = r.paciente_id
       JOIN medicos m ON m.id = r.medico_id
       LEFT JOIN expediente_turnos t ON t.id = r.turno_id
       LEFT JOIN sucursales s ON s.id = t.sucursal_id
       LEFT JOIN consultas_medicas c ON c.id = r.consulta_id
       WHERE r.id = ?`,
      [req.params.id]
    );

    const [partidas] = await pool.query(
      'SELECT * FROM recetas_medicas_partidas WHERE receta_id = ? ORDER BY linea',
      [req.params.id]
    );

    const { relativePath, filename } = await generarPdfReceta({ ...receta, ...datos, partidas });

    res.json({ url: urlFirmada(relativePath, { absoluta: true }), filename });
  } catch (err) { next(err); }
}

module.exports = {
  listTurnosAbiertos, abrirTurno, cerrarTurno, buscarMedicamentos,
  listPacientes, getPaciente, createPaciente, updatePaciente, removePaciente,
  upsertAntecedentes,
  listConsultas, createConsulta,
  listRecetas, getReceta, createReceta, generarRecetaPdf,
};
