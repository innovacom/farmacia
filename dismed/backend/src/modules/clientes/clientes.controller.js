const { pool } = require('../../config/db');

async function list(req, res, next) {
  try {
    const soloActivos = req.query.activos === '1';
    const [rows] = await pool.query(
      `SELECT id, razon_social, nombre_comercial, rfc, regimen_fiscal, uso_cfdi, forma_pago, metodo_pago,
              codigo_postal, email, tipo_cliente, limite_credito, dias_credito,
              direccion_fiscal, cuenta_cobrar_codigo, serie_facturacion, activo,
              (SELECT COUNT(*) FROM clientes_sucursales s
                WHERE s.cliente_id = clientes.id AND s.activo = 1) AS num_sucursales
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
    const [sucursales] = await pool.query(
      'SELECT * FROM clientes_sucursales WHERE cliente_id = ? ORDER BY es_matriz DESC, nombre',
      [req.params.id]
    );
    res.json({ ...cliente, contactos, sucursales });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const {
      razon_social, nombre_comercial, rfc, regimen_fiscal, uso_cfdi, forma_pago, metodo_pago, codigo_postal, email,
      tipo_cliente, limite_credito, dias_credito, direccion_fiscal, notas, cuenta_cobrar_codigo, serie_facturacion,
    } = req.body;

    if (!razon_social || !rfc) {
      return res.status(400).json({ error: 'razon_social y rfc son requeridos' });
    }

    const [result] = await pool.query(
      `INSERT INTO clientes
        (razon_social, nombre_comercial, rfc, regimen_fiscal, uso_cfdi, forma_pago, metodo_pago, codigo_postal, email,
         tipo_cliente, limite_credito, dias_credito, direccion_fiscal, notas, cuenta_cobrar_codigo, serie_facturacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [razon_social, nombre_comercial || null, rfc, regimen_fiscal || null,
       uso_cfdi || null, forma_pago || null, metodo_pago || null, codigo_postal || null, email || null, tipo_cliente || 'otro', limite_credito || 0,
       dias_credito || 0, direccion_fiscal || null, notas || null, cuenta_cobrar_codigo || null, serie_facturacion || null]
    );
    await pool.query(
      `INSERT INTO clientes_sucursales (cliente_id, nombre, es_matriz, direccion_entrega, codigo_postal)
       VALUES (?, ?, 1, ?, ?)`,
      [result.insertId, nombre_comercial || razon_social, direccion_fiscal || null, codigo_postal || null]
    );
    res.status(201).json({ id: result.insertId, razon_social });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const fields = [
      'razon_social','nombre_comercial','rfc','regimen_fiscal','uso_cfdi','forma_pago','metodo_pago','codigo_postal','email',
      'tipo_cliente','limite_credito','dias_credito','direccion_fiscal','notas','activo',
      'cuenta_cobrar_codigo','serie_facturacion',
    ];
    const sets = [];
    const vals = [];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(f === 'serie_facturacion' && req.body[f] === '' ? null : req.body[f]); }
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
    const { nombre, puesto, email, telefono, es_principal, sucursal_id, area } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    if (es_principal) {
      await pool.query(
        'UPDATE clientes_contactos SET es_principal = 0 WHERE cliente_id = ?',
        [req.params.id]
      );
    }
    const [r] = await pool.query(
      `INSERT INTO clientes_contactos (cliente_id, sucursal_id, area, nombre, puesto, email, telefono, es_principal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, sucursal_id || null, area || null, nombre, puesto || null, email || null,
       telefono || null, es_principal ? 1 : 0]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
}

async function updateContacto(req, res, next) {
  try {
    const { nombre, puesto, email, telefono, es_principal, activo, sucursal_id, area } = req.body;
    if (es_principal) {
      await pool.query(
        'UPDATE clientes_contactos SET es_principal = 0 WHERE cliente_id = ?',
        [req.params.id]
      );
    }
    await pool.query(
      `UPDATE clientes_contactos SET nombre=?, puesto=?, email=?, telefono=?, es_principal=?, activo=?,
              sucursal_id=?, area=?
       WHERE id = ? AND cliente_id = ?`,
      [nombre, puesto || null, email || null, telefono || null,
       es_principal ? 1 : 0, activo !== undefined ? activo : 1,
       sucursal_id || null, area || null,
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

// ── Sucursales ───────────────────────────────────────────────────────────────
const SUC_CAMPOS = ['nombre', 'clave', 'direccion_entrega', 'codigo_postal', 'telefono',
  'latitud', 'longitud', 'limite_credito', 'dias_credito', 'notas', 'serie_facturacion', 'activo'];
const SUC_NULLABLE = ['clave', 'direccion_entrega', 'codigo_postal', 'telefono', 'latitud',
  'longitud', 'limite_credito', 'dias_credito', 'notas', 'serie_facturacion'];

function valSuc(f, v) {
  if (SUC_NULLABLE.includes(f) && (v === '' || v === undefined)) return null;
  return v;
}

async function listSucursales(req, res, next) {
  try {
    const soloActivas = req.query.activas === '1';
    const [rows] = await pool.query(
      `SELECT * FROM clientes_sucursales WHERE cliente_id = ? ${soloActivas ? 'AND activo = 1' : ''}
       ORDER BY es_matriz DESC, nombre`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createSucursal(req, res, next) {
  try {
    if (!req.body.nombre) return res.status(400).json({ error: 'nombre requerido' });
    const campos = SUC_CAMPOS.filter((f) => f !== 'activo' && req.body[f] !== undefined);
    const [r] = await pool.query(
      `INSERT INTO clientes_sucursales (cliente_id, ${campos.join(', ')})
       VALUES (?${', ?'.repeat(campos.length)})`,
      [req.params.id, ...campos.map((f) => valSuc(f, req.body[f]))]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
}

async function updateSucursal(req, res, next) {
  try {
    const sets = []; const vals = [];
    SUC_CAMPOS.forEach((f) => {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(valSuc(f, req.body[f])); }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
    vals.push(req.params.sid, req.params.id);
    const [r] = await pool.query(
      `UPDATE clientes_sucursales SET ${sets.join(', ')} WHERE id = ? AND cliente_id = ?`, vals);
    if (!r.affectedRows) return res.status(404).json({ error: 'Sucursal no encontrada' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/**
 * Convierte el cliente :id (hoy "cliente suelto", p. ej. "Pemex Central Norte")
 * en una sucursal del cliente destino_id (p. ej. "Petróleos Mexicanos").
 * Todo su historial (solicitudes, cotizaciones, pedidos, entregas, contactos,
 * SKUs) pasa al destino conservando la sucursal. El cliente origen queda inactivo.
 */
async function fusionar(req, res, next) {
  const origenId = Number(req.params.id);
  const destinoId = Number(req.body.destino_id);
  if (!destinoId || destinoId === origenId) {
    return res.status(400).json({ error: 'destino_id inválido' });
  }
  const conn = await pool.getConnection();
  try {
    const [[origen]] = await conn.query('SELECT * FROM clientes WHERE id = ?', [origenId]);
    const [[destino]] = await conn.query('SELECT * FROM clientes WHERE id = ?', [destinoId]);
    if (!origen || !destino) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (String(origen.rfc).toUpperCase() !== String(destino.rfc).toUpperCase() && !req.body.forzar) {
      return res.status(409).json({
        error: `Los RFC no coinciden (${origen.rfc} vs ${destino.rfc}). Confirma para fusionar de todos modos.`,
        requiere_forzar: true,
      });
    }

    await conn.beginTransaction();

    // Asegurar que el origen tenga al menos una sucursal (clientes previos a v73)
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM clientes_sucursales WHERE cliente_id = ?', [origenId]);
    if (!n) {
      await conn.query(
        `INSERT INTO clientes_sucursales (cliente_id, nombre, es_matriz, direccion_entrega, codigo_postal)
         VALUES (?, ?, 1, ?, ?)`,
        [origenId, origen.nombre_comercial || origen.razon_social, origen.direccion_fiscal, origen.codigo_postal]);
    }
    // Sus sucursales pasan al destino (ya no son matriz)
    await conn.query(
      'UPDATE clientes_sucursales SET cliente_id = ?, es_matriz = 0 WHERE cliente_id = ?',
      [destinoId, origenId]);

    // Reapuntar todas las tablas con FK a clientes (menos clientes_sucursales)
    const [fks] = await conn.query(
      `SELECT DISTINCT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'clientes'
          AND REFERENCED_COLUMN_NAME = 'id' AND TABLE_NAME <> 'clientes_sucursales'`);
    const movidos = {};
    for (const { t, c } of fks) {
      // IGNORE: clientes_skus tiene UNIQUE(cliente_id, sku_cliente); los repetidos se quedan en el origen
      const [r] = await conn.query(`UPDATE IGNORE \`${t}\` SET \`${c}\` = ? WHERE \`${c}\` = ?`, [destinoId, origenId]);
      if (r.affectedRows) movidos[t] = r.affectedRows;
    }

    await conn.query(
      `UPDATE clientes SET activo = 0, notas = CONCAT(COALESCE(notas, ''), ?) WHERE id = ?`,
      [`\n[Fusionado como sucursal del cliente #${destinoId} el ${new Date().toISOString().slice(0, 10)}]`, origenId]);

    await conn.commit();
    res.json({ ok: true, movidos });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = {
  list, getById, create, update, remove,
  listContactos, createContacto, updateContacto,
  listSkus,
  listSucursales, createSucursal, updateSucursal, fusionar,
};
