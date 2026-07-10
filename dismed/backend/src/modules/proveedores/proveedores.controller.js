const { pool } = require('../../config/db');

async function list(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.nombre_empresa, p.nombre_contacto, p.puesto_contacto, p.rfc,
              p.email_cotizaciones, p.telefono, p.whatsapp, p.dias_entrega_prom, p.notas, p.activo,
              p.cuenta_pasivo_codigo, p.cuenta_gasto_codigo,
              GROUP_CONCAT(pc.categoria ORDER BY pc.categoria) AS categorias
       FROM proveedores p
       LEFT JOIN proveedores_categorias pc ON pc.proveedor_id = p.id
       WHERE p.activo = 1
       GROUP BY p.id
       ORDER BY p.nombre_empresa`
    );
    rows.forEach((r) => { r.categorias = r.categorias ? r.categorias.split(',') : []; });
    res.json(rows);
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const [[prov]] = await pool.query('SELECT * FROM proveedores WHERE id = ?', [req.params.id]);
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });
    const [cats] = await pool.query(
      'SELECT categoria FROM proveedores_categorias WHERE proveedor_id = ?', [req.params.id]
    );
    prov.categorias = cats.map((c) => c.categoria);
    res.json(prov);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const {
      nombre_empresa, nombre_contacto, puesto_contacto, rfc,
      email_cotizaciones, telefono, whatsapp, dias_entrega_prom, notas, categorias,
      cuenta_pasivo_codigo, cuenta_gasto_codigo,
    } = req.body;
    if (!nombre_empresa) return res.status(400).json({ error: 'nombre_empresa requerido' });

    const [r] = await conn.query(
      `INSERT INTO proveedores
        (nombre_empresa, nombre_contacto, puesto_contacto, rfc, email_cotizaciones,
         telefono, whatsapp, dias_entrega_prom, notas,
         cuenta_pasivo_codigo, cuenta_gasto_codigo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre_empresa, nombre_contacto || null, puesto_contacto || null, rfc || null,
       email_cotizaciones || null, telefono || null, whatsapp || null,
       dias_entrega_prom || 3, notas || null,
       cuenta_pasivo_codigo || null, cuenta_gasto_codigo || null]
    );

    const id = r.insertId;
    if (Array.isArray(categorias) && categorias.length) {
      const vals = categorias.map((cat) => [id, cat]);
      await conn.query('INSERT INTO proveedores_categorias (proveedor_id, categoria) VALUES ?', [vals]);
    }

    await conn.commit();
    res.status(201).json({ id, nombre_empresa });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function update(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const fields = [
      'nombre_empresa','nombre_contacto','puesto_contacto','rfc',
      'email_cotizaciones','telefono','whatsapp','dias_entrega_prom','notas','activo',
      'cuenta_pasivo_codigo','cuenta_gasto_codigo',
    ];
    const sets = []; const vals = [];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    });
    if (sets.length) {
      vals.push(req.params.id);
      await conn.query(`UPDATE proveedores SET ${sets.join(', ')} WHERE id = ?`, vals);
    }
    if (Array.isArray(req.body.categorias)) {
      await conn.query('DELETE FROM proveedores_categorias WHERE proveedor_id = ?', [req.params.id]);
      if (req.body.categorias.length) {
        const catVals = req.body.categorias.map((cat) => [req.params.id, cat]);
        await conn.query('INSERT INTO proveedores_categorias (proveedor_id, categoria) VALUES ?', [catVals]);
      }
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function remove(req, res, next) {
  try {
    await pool.query('UPDATE proveedores SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function removeMultiple(req, res, next) {
  try {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids requerido' });
    await pool.query('UPDATE proveedores SET activo = 0 WHERE id IN (?)', [ids]);
    res.json({ ok: true, count: ids.length });
  } catch (err) { next(err); }
}

async function removeCatalogo(req, res, next) {
  try {
    await pool.query(
      'DELETE FROM proveedores_catalogo WHERE proveedor_id = ? AND sku_proveedor = ?',
      [req.params.id, req.params.sku]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function removeCatalogoMultiple(req, res, next) {
  try {
    const skus = req.body.skus;
    if (!Array.isArray(skus) || skus.length === 0) return res.status(400).json({ error: 'skus requerido' });
    await pool.query(
      'DELETE FROM proveedores_catalogo WHERE proveedor_id = ? AND sku_proveedor IN (?)',
      [req.params.id, skus]
    );
    res.json({ ok: true, count: skus.length });
  } catch (err) { next(err); }
}

async function listSkus(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT ps.*, p.sku_interno, p.descripcion AS descripcion_interna
       FROM proveedores_skus ps
       LEFT JOIN productos p ON p.id = ps.producto_id
       WHERE ps.proveedor_id = ?
       ORDER BY ps.sku_proveedor`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

/**
 * Catálogo/tarifario del proveedor con filtros y paginación.
 * GET /proveedores/:id/catalogo?q=&vinculado=0|1&limit=&offset=
 */
async function catalogo(req, res, next) {
  try {
    const { q, vinculado } = req.query;
    const where = ['pc.proveedor_id = ?'];
    const vals = [req.params.id];
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      where.push('(pc.sku_proveedor LIKE ? OR pc.descripcion LIKE ? OR pc.referencia_fabricante LIKE ? OR pc.fabricante LIKE ? OR pc.sku_innovacom LIKE ?)');
      vals.push(like, like, like, like, like);
    }
    if (vinculado === '1') where.push('pc.producto_id IS NOT NULL');
    else if (vinculado === '0') where.push('pc.producto_id IS NULL');

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const w = where.join(' AND ');

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM proveedores_catalogo pc WHERE ${w}`, vals
    );
    const [rows] = await pool.query(
      `SELECT pc.proveedor_id, pc.sku_proveedor, pc.referencia_fabricante, pc.fabricante, pc.descripcion,
              pc.unidad_medida, pc.precio_lista, pc.moneda, pc.vigencia, pc.fecha_precio,
              pc.sku_innovacom, pc.producto_id, pc.match_estado,
              pr.sku_interno, pr.descripcion AS descripcion_interna
       FROM proveedores_catalogo pc
       LEFT JOIN productos pr ON pr.id = pc.producto_id
       WHERE ${w}
       ORDER BY pc.sku_proveedor
       LIMIT ? OFFSET ?`,
      [...vals, limit, offset]
    );
    res.json({ total: cnt.total, limit, offset, rows });
  } catch (err) { next(err); }
}

/**
 * Alta manual de un renglón del catálogo del proveedor.
 * POST /proveedores/:id/catalogo
 * body: { sku_proveedor, descripcion, referencia_fabricante, fabricante,
 *         unidad_medida, precio_lista, moneda, sku_innovacom, producto_id }
 */
async function createCatalogo(req, res, next) {
  try {
    const sku = (req.body.sku_proveedor || '').trim().slice(0, 40);
    if (!sku) return res.status(400).json({ error: 'sku_proveedor requerido' });

    let precio = null;
    if (req.body.precio_lista !== undefined && req.body.precio_lista !== '' && req.body.precio_lista != null) {
      precio = parseFloat(req.body.precio_lista);
      if (!Number.isFinite(precio) || precio < 0) {
        return res.status(400).json({ error: 'precio_lista inválido' });
      }
    }

    const pid = req.body.producto_id || null;
    await pool.query(
      `INSERT INTO proveedores_catalogo
        (proveedor_id, sku_proveedor, referencia_fabricante, fabricante, descripcion,
         unidad_medida, precio_lista, moneda, sku_innovacom, producto_id, match_estado, fecha_precio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${precio != null ? 'CURDATE()' : 'NULL'})`,
      [
        req.params.id, sku,
        (req.body.referencia_fabricante || '').trim().slice(0, 80) || null,
        (req.body.fabricante || '').trim().slice(0, 100) || null,
        (req.body.descripcion || '').trim().slice(0, 800) || null,
        (req.body.unidad_medida || '').trim().slice(0, 20) || null,
        precio,
        (req.body.moneda || 'MXN').trim().toUpperCase().slice(0, 3),
        (req.body.sku_innovacom || '').trim().slice(0, 20) || null,
        pid,
        pid ? 'confirmado' : 'sin_vincular',
      ]
    );
    res.status(201).json({ ok: true, sku_proveedor: sku });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese SKU ya existe en el catálogo de este proveedor' });
    }
    next(err);
  }
}

/**
 * Edita un renglón del catálogo: vínculo a producto y/o precio de lista.
 * PUT /proveedores/:id/catalogo/:sku   body: { producto_id, precio_lista }
 */
async function updateCatalogo(req, res, next) {
  try {
    const sets = []; const vals = [];
    if (req.body.producto_id !== undefined) {
      const pid = req.body.producto_id || null;
      sets.push('producto_id = ?'); vals.push(pid);
      sets.push('match_estado = ?'); vals.push(pid ? 'confirmado' : 'sin_vincular');
    }
    if (req.body.precio_lista !== undefined) {
      const precio = req.body.precio_lista === '' || req.body.precio_lista == null
        ? null : parseFloat(req.body.precio_lista);
      sets.push('precio_lista = ?'); vals.push(Number.isNaN(precio) ? null : precio);
      // Precio editado manualmente = precio vigente desde hoy.
      sets.push('fecha_precio = CURDATE()');
    }
    if (req.body.fabricante !== undefined) {
      const fab = (req.body.fabricante || '').trim().slice(0, 100) || null;
      sets.push('fabricante = ?'); vals.push(fab);
    }
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id, req.params.sku);
    await pool.query(
      `UPDATE proveedores_catalogo SET ${sets.join(', ')}
       WHERE proveedor_id = ? AND sku_proveedor = ?`,
      vals
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { list, getById, create, update, remove, removeMultiple, listSkus, catalogo, createCatalogo, updateCatalogo, removeCatalogo, removeCatalogoMultiple };
