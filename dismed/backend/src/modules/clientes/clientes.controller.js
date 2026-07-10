const { pool } = require('../../config/db');

async function list(req, res, next) {
  try {
    const soloActivos = req.query.activos === '1';
    const [rows] = await pool.query(
      `SELECT id, razon_social, nombre_comercial, rfc, regimen_fiscal, uso_cfdi,
              codigo_postal, email, tipo_cliente, limite_credito, dias_credito,
              direccion_fiscal, cuenta_cobrar_codigo, activo
       FROM clientes
       ${soloActivos ? 'WHERE activo = 1' : ''}
       ORDER BY razon_social`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const [[cliente]] = await pool.query(
      'SELECT * FROM clientes WHERE id = ?', [req.params.id]
    );
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const [contactos] = await pool.query(
      'SELECT * FROM clientes_contactos WHERE cliente_id = ? AND activo = 1 ORDER BY es_principal DESC',
      [req.params.id]
    );
    res.json({ ...cliente, contactos });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const {
      razon_social, nombre_comercial, rfc, regimen_fiscal, uso_cfdi, codigo_postal, email,
      tipo_cliente, limite_credito, dias_credito, direccion_fiscal, notas, cuenta_cobrar_codigo,
    } = req.body;

    if (!razon_social || !rfc) {
      return res.status(400).json({ error: 'razon_social y rfc son requeridos' });
    }

    const [result] = await pool.query(
      `INSERT INTO clientes
        (razon_social, nombre_comercial, rfc, regimen_fiscal, uso_cfdi, codigo_postal, email,
         tipo_cliente, limite_credito, dias_credito, direccion_fiscal, notas, cuenta_cobrar_codigo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [razon_social, nombre_comercial || null, rfc, regimen_fiscal || null,
       uso_cfdi || null, codigo_postal || null, email || null, tipo_cliente || 'otro', limite_credito || 0,
       dias_credito || 0, direccion_fiscal || null, notas || null, cuenta_cobrar_codigo || null]
    );
    res.status(201).json({ id: result.insertId, razon_social });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const fields = [
      'razon_social','nombre_comercial','rfc','regimen_fiscal','uso_cfdi','codigo_postal','email',
      'tipo_cliente','limite_credito','dias_credito','direccion_fiscal','notas','activo',
      'cuenta_cobrar_codigo',
    ];
    const sets = [];
    const vals = [];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
    vals.push(req.params.id);
    await pool.query(`UPDATE clientes SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    await pool.query('UPDATE clientes SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function listContactos(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM clientes_contactos WHERE cliente_id = ? ORDER BY es_principal DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createContacto(req, res, next) {
  try {
    const { nombre, puesto, email, telefono, es_principal } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    if (es_principal) {
      await pool.query(
        'UPDATE clientes_contactos SET es_principal = 0 WHERE cliente_id = ?',
        [req.params.id]
      );
    }
    const [r] = await pool.query(
      `INSERT INTO clientes_contactos (cliente_id, nombre, puesto, email, telefono, es_principal)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.id, nombre, puesto || null, email || null, telefono || null, es_principal ? 1 : 0]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
}

async function updateContacto(req, res, next) {
  try {
    const { nombre, puesto, email, telefono, es_principal, activo } = req.body;
    if (es_principal) {
      await pool.query(
        'UPDATE clientes_contactos SET es_principal = 0 WHERE cliente_id = ?',
        [req.params.id]
      );
    }
    await pool.query(
      `UPDATE clientes_contactos SET nombre=?, puesto=?, email=?, telefono=?, es_principal=?, activo=?
       WHERE id = ? AND cliente_id = ?`,
      [nombre, puesto || null, email || null, telefono || null,
       es_principal ? 1 : 0, activo !== undefined ? activo : 1,
       req.params.cid, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function listSkus(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT cs.*, p.sku_interno, p.descripcion AS descripcion_interna
       FROM clientes_skus cs
       LEFT JOIN productos p ON p.id = cs.producto_id
       WHERE cs.cliente_id = ?
       ORDER BY cs.sku_cliente`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

module.exports = {
  list, getById, create, update, remove,
  listContactos, createContacto, updateContacto,
  listSkus,
};
