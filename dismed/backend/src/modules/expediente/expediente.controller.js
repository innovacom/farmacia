const { pool } = require('../../config/db');

// ── Pacientes ────────────────────────────────────────────────────────────────

async function listPacientes(req, res, next) {
  try {
    const { cliente_id, q } = req.query;
    const soloActivos = req.query.activos === '1';
    const where = [];
    const vals = [];
    if (cliente_id) { where.push('p.cliente_id = ?'); vals.push(cliente_id); }
    if (soloActivos) where.push('p.activo = 1');
    if (q) {
      where.push('(p.nombre LIKE ? OR p.apellido_paterno LIKE ? OR p.apellido_materno LIKE ? OR p.curp LIKE ?)');
      const t = `%${q}%`;
      vals.push(t, t, t, t);
    }
    const [rows] = await pool.query(
      `SELECT p.*, cl.razon_social AS cliente_nombre
       FROM pacientes p
       JOIN clientes cl ON cl.id = p.cliente_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.nombre, p.apellido_paterno`,
      vals
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getPaciente(req, res, next) {
  try {
    const [[paciente]] = await pool.query(
      `SELECT p.*, cl.razon_social AS cliente_nombre
       FROM pacientes p JOIN clientes cl ON cl.id = p.cliente_id
       WHERE p.id = ?`, [req.params.id]
    );
    if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado' });

    const [[antecedentes]] = await pool.query(
      'SELECT * FROM expedientes_clinicos WHERE paciente_id = ?', [req.params.id]
    );
    res.json({ ...paciente, antecedentes: antecedentes || null });
  } catch (err) { next(err); }
}

async function createPaciente(req, res, next) {
  try {
    const {
      cliente_id, nombre, apellido_paterno, apellido_materno, fecha_nacimiento, sexo,
      curp, telefono, email, direccion, tipo_sangre, alergias,
      contacto_emergencia_nombre, contacto_emergencia_telefono,
    } = req.body;

    if (!cliente_id || !nombre) {
      return res.status(400).json({ error: 'cliente_id y nombre son requeridos' });
    }

    const [result] = await pool.query(
      `INSERT INTO pacientes
        (cliente_id, nombre, apellido_paterno, apellido_materno, fecha_nacimiento, sexo,
         curp, telefono, email, direccion, tipo_sangre, alergias,
         contacto_emergencia_nombre, contacto_emergencia_telefono)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cliente_id, nombre, apellido_paterno || null, apellido_materno || null,
       fecha_nacimiento || null, sexo || 'X', curp || null, telefono || null, email || null,
       direccion || null, tipo_sangre || null, alergias || null,
       contacto_emergencia_nombre || null, contacto_emergencia_telefono || null]
    );
    res.status(201).json({ id: result.insertId, nombre });
  } catch (err) { next(err); }
}

async function updatePaciente(req, res, next) {
  try {
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
    vals.push(req.params.id);
    await pool.query(`UPDATE pacientes SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function removePaciente(req, res, next) {
  try {
    await pool.query('UPDATE pacientes SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Antecedentes (NOM-004) ───────────────────────────────────────────────────

async function upsertAntecedentes(req, res, next) {
  try {
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
    const [rows] = await pool.query(
      `SELECT c.*, u.nombre AS capturado_por
       FROM consultas_medicas c
       LEFT JOIN usuarios u ON u.id = c.medico_usuario_id
       WHERE c.paciente_id = ?
       ORDER BY c.fecha_hora DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createConsulta(req, res, next) {
  try {
    const {
      fecha_hora, motivo_consulta, padecimiento_actual, exploracion_fisica,
      signos_vitales, diagnostico, plan_tratamiento, pronostico,
      medico_nombre, medico_cedula,
    } = req.body;

    const [result] = await pool.query(
      `INSERT INTO consultas_medicas
        (paciente_id, fecha_hora, motivo_consulta, padecimiento_actual, exploracion_fisica,
         signos_vitales, diagnostico, plan_tratamiento, pronostico,
         medico_usuario_id, medico_nombre, medico_cedula)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, fecha_hora || new Date(), motivo_consulta || null,
       padecimiento_actual || null, exploracion_fisica || null,
       signos_vitales ? JSON.stringify(signos_vitales) : null,
       diagnostico || null, plan_tratamiento || null, pronostico || null,
       req.user.id, medico_nombre || req.user.nombre, medico_cedula || null]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) { next(err); }
}

// ── Recetas electrónicas ─────────────────────────────────────────────────────

async function listRecetas(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, s.folio AS solicitud_folio
       FROM recetas_medicas r
       LEFT JOIN solicitudes s ON s.id = r.solicitud_id
       WHERE r.paciente_id = ?
       ORDER BY r.fecha DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getReceta(req, res, next) {
  try {
    const [[receta]] = await pool.query(
      `SELECT r.*, s.folio AS solicitud_folio
       FROM recetas_medicas r
       LEFT JOIN solicitudes s ON s.id = r.solicitud_id
       WHERE r.id = ?`, [req.params.id]
    );
    if (!receta) return res.status(404).json({ error: 'Receta no encontrada' });

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
    const { consulta_id, medico_nombre, medico_cedula, indicaciones_generales, vigencia_dias, partidas } = req.body;
    if (!Array.isArray(partidas) || !partidas.length) {
      return res.status(400).json({ error: 'La receta requiere al menos una partida' });
    }

    await conn.beginTransaction();
    await conn.query('CALL sp_generar_folio(?, @folio)', ['REC']);
    const [[{ folio }]] = await conn.query('SELECT @folio AS folio');

    const [r] = await conn.query(
      `INSERT INTO recetas_medicas
        (folio, paciente_id, consulta_id, medico_usuario_id, medico_nombre, medico_cedula,
         indicaciones_generales, vigencia_dias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio, req.params.id, consulta_id || null, req.user.id,
       medico_nombre || req.user.nombre, medico_cedula || null,
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

// Cierra el ciclo: convierte los medicamentos de la receta que sí existen en el
// catálogo DISMED en una solicitud de cotización para el cliente del paciente.
async function generarSolicitud(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const [[receta]] = await conn.query(
      'SELECT * FROM recetas_medicas WHERE id = ?', [req.params.id]
    );
    if (!receta) { conn.release(); return res.status(404).json({ error: 'Receta no encontrada' }); }
    if (receta.solicitud_id) {
      conn.release();
      return res.status(400).json({ error: 'Esta receta ya generó la solicitud ' + receta.solicitud_id });
    }

    const [[paciente]] = await conn.query(
      'SELECT cliente_id FROM pacientes WHERE id = ?', [receta.paciente_id]
    );

    const [partidas] = await conn.query(
      `SELECT * FROM recetas_medicas_partidas WHERE receta_id = ? AND producto_id IS NOT NULL ORDER BY linea`,
      [receta.id]
    );
    if (!partidas.length) {
      conn.release();
      return res.status(400).json({ error: 'La receta no tiene medicamentos del catálogo DISMED para cotizar' });
    }

    await conn.beginTransaction();
    await conn.query('CALL sp_generar_folio(?, @folio)', ['SOL']);
    const [[{ folio }]] = await conn.query('SELECT @folio AS folio');

    const [sol] = await conn.query(
      `INSERT INTO solicitudes (folio, cliente_id, tipo_origen, notas)
       VALUES (?, ?, 'manual', ?)`,
      [folio, paciente.cliente_id, `Generada automáticamente desde receta ${receta.folio}`]
    );

    let linea = 1;
    for (const p of partidas) {
      const obs = [p.dosis, p.via_administracion, p.frecuencia, p.duracion].filter(Boolean).join(' · ');
      await conn.query(
        `INSERT INTO solicitudes_partidas
          (solicitud_id, linea, descripcion_original, producto_id, cantidad, unidad_medida, observaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sol.insertId, linea++, p.medicamento_nombre, p.producto_id, p.cantidad,
         p.presentacion || 'pza', obs || null]
      );
    }

    await conn.query('UPDATE recetas_medicas SET solicitud_id = ? WHERE id = ?', [sol.insertId, receta.id]);

    await conn.commit();
    res.status(201).json({ solicitud_id: sol.insertId, folio });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = {
  listPacientes, getPaciente, createPaciente, updatePaciente, removePaciente,
  upsertAntecedentes,
  listConsultas, createConsulta,
  listRecetas, getReceta, createReceta, generarSolicitud,
};
