const { pool } = require('../../config/db');
const { parseExcel: doParseExcel } = require('./parser.excel');
const { parsePdf: doParsePdf } = require('./parser.pdf');
const { buscarPrecioWeb: doBuscarPrecioWeb } = require('./buscador.web');
const { normalizar, tokenizar, score } = require('./matcher');
const cache = require('./precios.cache');
const { getVigencias } = require('../../config/precios');

/** Formatea una fecha (Date o string de MySQL) como YYYY-MM-DD para comentarios. */
function fechaCorta(fecha) {
  if (!fecha) return '';
  if (fecha instanceof Date) return fecha.toISOString().slice(0, 10);
  return String(fecha).slice(0, 10);
}

async function list(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.folio, s.tipo_origen, s.estatus, s.created_at,
              c.razon_social AS cliente,
              (SELECT COUNT(*) FROM solicitudes_partidas WHERE solicitud_id = s.id) AS num_partidas
       FROM solicitudes s
       JOIN clientes c ON c.id = s.cliente_id
       ORDER BY s.created_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const [[sol]] = await pool.query(
      `SELECT s.*, c.razon_social AS cliente_nombre
       FROM solicitudes s
       JOIN clientes c ON c.id = s.cliente_id
       WHERE s.id = ?`,
      [req.params.id]
    );
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });

    const [partidas] = await pool.query(
      `SELECT sp.*, p.sku_interno, p.descripcion AS descripcion_interna
       FROM solicitudes_partidas sp
       LEFT JOIN productos p ON p.id = sp.producto_id
       WHERE sp.solicitud_id = ?
       ORDER BY sp.linea`,
      [req.params.id]
    );

    res.json({ ...sol, partidas });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { cliente_id, contacto_id, referencia_cliente, atencion, concepto,
            factor_ganancia, tipo_origen, notas } = req.body;
    if (!cliente_id) return res.status(400).json({ error: 'cliente_id requerido' });

    await conn.query('CALL sp_generar_folio(?, @folio)', ['SOL']);
    const [[{ folio }]] = await conn.query('SELECT @folio AS folio');

    const [r] = await conn.query(
      `INSERT INTO solicitudes
        (folio, cliente_id, contacto_id, referencia_cliente, atencion, concepto,
         factor_ganancia, tipo_origen, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio, cliente_id, contacto_id || null, referencia_cliente || null,
       atencion || null, concepto || null,
       factor_ganancia != null ? parseFloat(factor_ganancia) : null,
       tipo_origen || 'manual', notas || null]
    );

    await conn.commit();
    res.status(201).json({ id: r.insertId, folio });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function update(req, res, next) {
  try {
    const fields = ['referencia_cliente','atencion','concepto','estatus','notas','contacto_id'];
    const sets = []; const vals = [];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id);
    await pool.query(`UPDATE solicitudes SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Parsers ───────────────────────────────────────────────────────────────────

async function parseExcel(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const result = doParseExcel(req.file.path);
    // Retorna: { meta: { cliente_nombre, coc, factor_ganancia, ... }, partidas, proveedores }
    res.json(result);
  } catch (err) { next(err); }
}

async function parsePdf(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const result = await doParsePdf(req.file.path);
    res.json(result);
  } catch (err) { next(err); }
}

// ── Partidas ──────────────────────────────────────────────────────────────────

/**
 * Heurística para determinar si el valor de la columna "comentario" del proveedor
 * es un código de producto (SKU) o un comentario/URL.
 *
 * Reglas (en orden):
 *  1. URL (http/https/www)  → comentario
 *  2. Longitud > 30 chars   → comentario
 *  3. > 3 palabras          → comentario
 *  4. Palabras en español que indican disponibilidad/notas → comentario
 *  5. Todo lo demás         → SKU
 */
function clasificarComentarioProveedor(valor) {
  if (!valor || !valor.trim()) return { sku: null, obs: null };
  const v = valor.trim();

  const esComentario =
    /^https?:\/\//i.test(v) ||                          // URL con protocolo
    /^www\./i.test(v) ||                                 // URL sin protocolo
    v.length > 30 ||                                     // demasiado largo para SKU
    v.split(/\s+/).length > 3 ||                         // más de 3 palabras
    /\b(d[ií]as?|semanas?|agotado|falta|ofrezco|ofrece?|para\s|con\s|sin\s|de\s|del\s|en\s|no\s|requiere?|necesita|entrega|disponib|stock|precio|tiempo|pedido|espera|verific|marca|cantidad|incluye|cotiz)\b/i.test(v);

  return esComentario
    ? { sku: null,        obs: v.substring(0, 1000) }
    : { sku: v.substring(0, 30), obs: null };
}

async function bulkPartidas(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { partidas, archivo_origen, tipo_origen, precios_proveedores } = req.body;
    if (!Array.isArray(partidas) || !partidas.length) {
      return res.status(400).json({ error: 'partidas[] requerido' });
    }

    // RN-001: validar duplicados de número de partida
    const lineas = partidas.map((p) => Number(p.linea)).filter((l) => !isNaN(l) && l > 0);
    const duplicados = lineas.filter((l, i) => lineas.indexOf(l) !== i);
    if (duplicados.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        error: `Números de partida duplicados: ${[...new Set(duplicados)].join(', ')}`,
      });
    }

    if (archivo_origen || tipo_origen) {
      await conn.query(
        'UPDATE solicitudes SET archivo_origen = COALESCE(?, archivo_origen), tipo_origen = COALESCE(?, tipo_origen) WHERE id = ?',
        [archivo_origen || null, tipo_origen || null, req.params.id]
      );
    }

    // Limpiar datos previos (precios → cotprov → partidas, en orden FK)
    await conn.query(
      `DELETE cpp FROM cotizaciones_proveedor_precios cpp
       JOIN cotizaciones_proveedor cp ON cp.id = cpp.cotizacion_proveedor_id
       WHERE cp.solicitud_id = ?`, [req.params.id]
    );
    await conn.query('DELETE FROM cotizaciones_proveedor WHERE solicitud_id = ?', [req.params.id]);
    await conn.query('DELETE FROM solicitudes_partidas WHERE solicitud_id = ?', [req.params.id]);

    const [[sol]] = await conn.query('SELECT cliente_id FROM solicitudes WHERE id = ?', [req.params.id]);

    // ── 1. Insertar partidas ────────────────────────────────────────────────
    for (let i = 0; i < partidas.length; i++) {
      const p = partidas[i];
      const linea = (p.linea !== undefined && p.linea !== null && !isNaN(Number(p.linea)))
        ? Number(p.linea) : i + 1;

      // Resolver vínculo con catálogo + estado/origen (Fase 3).
      let productoId = p.producto_id || null;
      let matchEstado = 'sin_vincular', matchOrigen = null, matchScore = null;

      if (productoId) {
        // El usuario lo eligió en la tabla editable → confirmado.
        matchEstado = 'confirmado'; matchOrigen = 'manual';
        matchScore = p.match_score != null ? p.match_score : null;
      } else if (p.codigo_cliente && sol) {
        // Código de cliente confirmado en el diccionario → auto-vincula (sugerido).
        const [[sku]] = await conn.query(
          'SELECT producto_id FROM clientes_skus WHERE cliente_id = ? AND sku_cliente = ? AND confirmado = 1',
          [sol.cliente_id, p.codigo_cliente]
        );
        if (sku) {
          productoId = sku.producto_id;
          matchEstado = 'sugerido'; matchOrigen = 'codigo_cliente'; matchScore = 1;
        }
      }
      // Clave de cuadro básico / gobierno (exacta) → auto-vincula (sugerido).
      if (!productoId && p.codigo_gobierno) {
        try {
          const [[prod]] = await conn.query(
            'SELECT id FROM productos WHERE activo = 1 AND clave_cuadro_basico = ? LIMIT 1',
            [String(p.codigo_gobierno).trim()]
          );
          if (prod) {
            productoId = prod.id;
            matchEstado = 'sugerido'; matchOrigen = 'codigo_gobierno'; matchScore = 1;
          }
        } catch (_) { /* columna aún sin migrar */ }
      }

      await conn.query(
        `INSERT INTO solicitudes_partidas
          (solicitud_id, linea, codigo_cliente, codigo_gobierno,
           descripcion_original, producto_id, cantidad, unidad_medida, observaciones, iva_exento,
           match_estado, match_score, match_origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.params.id, linea,
         p.codigo_cliente || null, p.codigo_gobierno || null,
         p.descripcion_original, productoId,
         p.cantidad || 1, p.unidad_medida || 'pza', p.observaciones || null,
         p.iva_exento ? 1 : 0,
         matchEstado, matchScore, matchOrigen]
      );
    }

    // ── 2. Importar precios de proveedores del Excel ────────────────────────
    if (precios_proveedores && typeof precios_proveedores === 'object'
        && Object.keys(precios_proveedores).length > 0) {

      // Mapa linea → partida_id
      const [partidasDB] = await conn.query(
        'SELECT id, linea FROM solicitudes_partidas WHERE solicitud_id = ?', [req.params.id]
      );
      const lineaIdMap = {};
      for (const p of partidasDB) lineaIdMap[Number(p.linea)] = p.id;

      for (const [nombreProv, precios] of Object.entries(precios_proveedores)) {
        if (!Array.isArray(precios) || !precios.length) continue;

        // Buscar proveedor (insensible a mayúsculas y espacios)
        let [[prov]] = await conn.query(
          `SELECT id FROM proveedores
           WHERE LOWER(TRIM(nombre_empresa)) = LOWER(TRIM(?)) LIMIT 1`,
          [nombreProv]
        );
        // Auto-crear si no existe (solo nombre, datos mínimos)
        if (!prov) {
          const [r] = await conn.query(
            'INSERT INTO proveedores (nombre_empresa, activo) VALUES (?, 1)',
            [nombreProv.trim()]
          );
          prov = { id: r.insertId };
        }

        // Crear cotizacion_proveedor en estatus 'recibida' (ya tenemos precios)
        await conn.query(
          `INSERT INTO cotizaciones_proveedor (solicitud_id, proveedor_id, estatus, fecha_respuesta)
           VALUES (?, ?, 'recibida', NOW())
           ON DUPLICATE KEY UPDATE estatus = 'recibida', fecha_respuesta = NOW()`,
          [req.params.id, prov.id]
        );
        const [[cpRow]] = await conn.query(
          'SELECT id FROM cotizaciones_proveedor WHERE solicitud_id = ? AND proveedor_id = ?',
          [req.params.id, prov.id]
        );
        if (!cpRow) continue;

        for (const item of precios) {
          const partidaId = lineaIdMap[Number(item.linea)];
          if (!partidaId) continue;
          const precio     = parseFloat(item.precio) || 0;
          const disponible = precio > 0 ? 1 : 0;
          // Clasificar si el comentario es un SKU o texto libre
          const { sku, obs } = clasificarComentarioProveedor(item.comentario);
          await conn.query(
            `INSERT INTO cotizaciones_proveedor_precios
               (cotizacion_proveedor_id, partida_id, sku_proveedor,
                observaciones_proveedor, precio_unitario, disponible)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               sku_proveedor           = VALUES(sku_proveedor),
               observaciones_proveedor = VALUES(observaciones_proveedor),
               precio_unitario         = VALUES(precio_unitario),
               disponible              = VALUES(disponible)`,
            [cpRow.id, partidaId, sku, obs,
             disponible ? precio : null, disponible]
          );
        }
      }

      // ── 3. Marcar mejor precio por partida ─────────────────────────────────
      const [todasPartidas] = await conn.query(
        'SELECT id FROM solicitudes_partidas WHERE solicitud_id = ?', [req.params.id]
      );
      for (const { id: pid } of todasPartidas) {
        await conn.query(
          `UPDATE cotizaciones_proveedor_precios cpp
           JOIN cotizaciones_proveedor cp ON cp.id = cpp.cotizacion_proveedor_id
           SET cpp.es_mejor_precio = 0
           WHERE cpp.partida_id = ? AND cp.solicitud_id = ?`, [pid, req.params.id]
        );
        const [[mejor]] = await conn.query(
          `SELECT cpp.id FROM cotizaciones_proveedor_precios cpp
           JOIN cotizaciones_proveedor cp ON cp.id = cpp.cotizacion_proveedor_id
           WHERE cpp.partida_id = ? AND cp.solicitud_id = ?
             AND cpp.disponible = 1 AND cpp.precio_unitario IS NOT NULL
           ORDER BY cpp.precio_unitario ASC LIMIT 1`, [pid, req.params.id]
        );
        if (mejor) {
          await conn.query(
            'UPDATE cotizaciones_proveedor_precios SET es_mejor_precio = 1 WHERE id = ?',
            [mejor.id]
          );
        }
      }
    }

    await conn.commit();
    res.json({ ok: true, total: partidas.length });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function addPartida(req, res, next) {
  try {
    const { codigo_cliente, codigo_gobierno, descripcion_original,
            producto_id, cantidad, unidad_medida, observaciones, iva_exento } = req.body;
    if (!descripcion_original) return res.status(400).json({ error: 'descripcion_original requerida' });

    const [[maxLinea]] = await pool.query(
      'SELECT COALESCE(MAX(linea), 0) AS max FROM solicitudes_partidas WHERE solicitud_id = ?',
      [req.params.id]
    );

    const matchEstado = producto_id ? 'confirmado' : 'sin_vincular';
    const matchOrigen = producto_id ? 'manual' : null;

    const [r] = await pool.query(
      `INSERT INTO solicitudes_partidas
        (solicitud_id, linea, codigo_cliente, codigo_gobierno,
         descripcion_original, producto_id, cantidad, unidad_medida, observaciones, iva_exento,
         match_estado, match_origen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, maxLinea.max + 1,
       codigo_cliente || null, codigo_gobierno || null, descripcion_original,
       producto_id || null, cantidad || 1, unidad_medida || 'pza', observaciones || null,
       iva_exento ? 1 : 0,
       matchEstado, matchOrigen]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
}

async function updatePartida(req, res, next) {
  try {
    const fields = ['codigo_cliente','codigo_gobierno','descripcion_original',
                    'producto_id','cantidad','unidad_medida','observaciones','iva_exento'];
    const sets = []; const vals = [];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(f === 'iva_exento' ? (req.body[f] ? 1 : 0) : req.body[f]);
      }
    });

    // Estado de vinculación (Fase 3): al vincular manual → confirmado; al quitar → sin_vincular.
    if (req.body.producto_id !== undefined) {
      if (req.body.producto_id) {
        sets.push('match_estado = ?', 'match_origen = ?', 'match_score = ?');
        vals.push('confirmado', 'manual', req.body.match_score != null ? req.body.match_score : null);
      } else {
        sets.push('match_estado = ?', 'match_origen = ?', 'match_score = ?');
        vals.push('sin_vincular', null, null);
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });

    if (req.body.producto_id && req.body.codigo_cliente) {
      const [[sol]] = await pool.query(
        'SELECT cliente_id FROM solicitudes WHERE id = ?', [req.params.id]
      );
      if (sol) {
        await pool.query(
          `INSERT INTO clientes_skus (cliente_id, sku_cliente, descripcion_cliente, producto_id, confirmado)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE producto_id = VALUES(producto_id), confirmado = 1`,
          [sol.cliente_id, req.body.codigo_cliente,
           req.body.descripcion_original || null, req.body.producto_id]
        );
      }
    }

    vals.push(req.params.pid);
    await pool.query(`UPDATE solicitudes_partidas SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function deletePartida(req, res, next) {
  try {
    await pool.query('DELETE FROM solicitudes_partidas WHERE id = ? AND solicitud_id = ?',
      [req.params.pid, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/**
 * Registra (upsert) un precio de proveedor para una partida. Compartido por las
 * búsquedas de precio (catálogo y web). Crea/actualiza la cotizacion_proveedor en
 * estatus 'recibida' y el renglón en cotizaciones_proveedor_precios.
 */
async function registrarPrecioProveedor(conn, { solicitudId, proveedorId, partidaId, sku_proveedor, observaciones, precio }) {
  await conn.query(
    `INSERT INTO cotizaciones_proveedor (solicitud_id, proveedor_id, estatus, fecha_respuesta)
     VALUES (?, ?, 'recibida', NOW())
     ON DUPLICATE KEY UPDATE estatus = 'recibida', fecha_respuesta = NOW()`,
    [solicitudId, proveedorId]
  );
  const [[cpRow]] = await conn.query(
    'SELECT id FROM cotizaciones_proveedor WHERE solicitud_id = ? AND proveedor_id = ?',
    [solicitudId, proveedorId]
  );
  if (!cpRow) return false;
  await conn.query(
    `INSERT INTO cotizaciones_proveedor_precios
       (cotizacion_proveedor_id, partida_id, sku_proveedor,
        observaciones_proveedor, precio_unitario, disponible)
     VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       sku_proveedor           = VALUES(sku_proveedor),
       observaciones_proveedor = VALUES(observaciones_proveedor),
       precio_unitario         = VALUES(precio_unitario),
       disponible              = 1`,
    [cpRow.id, partidaId,
     sku_proveedor ? String(sku_proveedor).substring(0, 30) : null,
     observaciones ? String(observaciones).substring(0, 500) : null,
     precio]
  );
  return true;
}

/** Marca es_mejor_precio = 1 al renglón de menor precio disponible de la partida. */
async function recalcularMejorPrecio(conn, partidaId, solicitudId) {
  await conn.query(
    `UPDATE cotizaciones_proveedor_precios cpp
     JOIN cotizaciones_proveedor cp ON cp.id = cpp.cotizacion_proveedor_id
     SET cpp.es_mejor_precio = 0
     WHERE cpp.partida_id = ? AND cp.solicitud_id = ?`,
    [partidaId, solicitudId]
  );
  const [[mejor]] = await conn.query(
    `SELECT cpp.id FROM cotizaciones_proveedor_precios cpp
     JOIN cotizaciones_proveedor cp ON cp.id = cpp.cotizacion_proveedor_id
     WHERE cpp.partida_id = ? AND cp.solicitud_id = ?
       AND cpp.disponible = 1 AND cpp.precio_unitario IS NOT NULL
     ORDER BY cpp.precio_unitario ASC LIMIT 1`,
    [partidaId, solicitudId]
  );
  if (mejor) {
    await conn.query(
      'UPDATE cotizaciones_proveedor_precios SET es_mejor_precio = 1 WHERE id = ?', [mejor.id]
    );
  }
}

/** Sugerencias de catálogo por similitud de descripción (NUNCA auto-registra). */
async function sugerirCatalogoPorDescripcion(texto) {
  const norm = normalizar(texto);
  const qTokens = tokenizar(norm);
  const tokens = [...qTokens.texto].sort((a, b) => b.length - a.length).slice(0, 4);
  if (!tokens.length) return [];
  const conds = tokens.map(() => 'pc.descripcion LIKE ?');
  const vals = tokens.map((t) => `%${t}%`);
  const { vigencia_catalogo_meses } = await getVigencias();
  const [rows] = await pool.query(
    `SELECT pc.proveedor_id, pc.sku_proveedor, pc.referencia_fabricante, pc.descripcion,
            pc.unidad_medida, pc.precio_lista, pc.vigencia, pc.fecha_precio, pc.sku_innovacom,
            pr.nombre_empresa AS proveedor
     FROM proveedores_catalogo pc
     JOIN proveedores pr ON pr.id = pc.proveedor_id
     WHERE pc.activo = 1 AND pc.precio_lista IS NOT NULL
       AND (pc.fecha_precio IS NULL OR pc.fecha_precio >= DATE_SUB(CURDATE(), INTERVAL ? MONTH))
       AND (${conds.join(' OR ')})
     LIMIT 60`,
    [vigencia_catalogo_meses, ...vals]
  );
  const out = [];
  for (const r of rows) {
    const sc = score(qTokens, normalizar(r.descripcion || ''));
    if (sc < 0.2) continue;
    out.push({ ...r, score: Math.round(sc * 100) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 5);
}

/**
 * PRIMERA opción de búsqueda automática: precio de UNA partida en el catálogo de
 * proveedores (proveedores_catalogo). Auto-registra SOLO cuando hay vínculo confiable
 * (producto_id igual o código exacto). El match por descripción se devuelve como
 * sugerencia y NO se registra (regla de negocio: solo códigos exactos auto-vinculan).
 * POST /solicitudes/:id/partidas/:pid/buscar-precio-catalogo
 */
async function buscarPrecioCatalogoPartida(req, res, next) {
  try {
    const [[partida]] = await pool.query(
      'SELECT * FROM solicitudes_partidas WHERE id = ? AND solicitud_id = ?',
      [req.params.pid, req.params.id]
    );
    if (!partida) return res.status(404).json({ error: 'Partida no encontrada' });

    const selCols = `pc.proveedor_id, pc.sku_proveedor, pc.referencia_fabricante, pc.descripcion,
                     pc.unidad_medida, pc.precio_lista, pc.vigencia, pc.fecha_precio, pc.sku_innovacom,
                     pr.nombre_empresa AS proveedor`;
    // Solo se consideran precios VIGENTES (dentro de la ventana de validez del catálogo).
    const { vigencia_catalogo_meses } = await getVigencias();
    const vigente = '(pc.fecha_precio IS NULL OR pc.fecha_precio >= DATE_SUB(CURDATE(), INTERVAL ? MONTH))';
    const matches = [];

    // 1) Vínculo confiable por producto_id
    if (partida.producto_id) {
      const [rows] = await pool.query(
        `SELECT ${selCols} FROM proveedores_catalogo pc
         JOIN proveedores pr ON pr.id = pc.proveedor_id
         WHERE pc.producto_id = ? AND pc.precio_lista IS NOT NULL AND pc.activo = 1
           AND ${vigente}`,
        [partida.producto_id, vigencia_catalogo_meses]
      );
      rows.forEach((r) => matches.push({ ...r, motivo: 'producto_id' }));
    }

    // 2) Código exacto (referencia_fabricante o sku_proveedor) = codigo_gobierno/codigo_cliente
    const codigos = [partida.codigo_gobierno, partida.codigo_cliente]
      .map((c) => (c || '').toString().trim()).filter(Boolean);
    if (!matches.length && codigos.length) {
      const [rows] = await pool.query(
        `SELECT ${selCols} FROM proveedores_catalogo pc
         JOIN proveedores pr ON pr.id = pc.proveedor_id
         WHERE pc.precio_lista IS NOT NULL AND pc.activo = 1 AND ${vigente}
           AND (pc.referencia_fabricante IN (?) OR pc.sku_proveedor IN (?))`,
        [vigencia_catalogo_meses, codigos, codigos]
      );
      rows.forEach((r) => matches.push({ ...r, motivo: 'codigo_exacto' }));
    }

    // 3) Sugerencias por descripción (no registra)
    let sugerencias = [];
    if (!matches.length && partida.descripcion_original) {
      sugerencias = await sugerirCatalogoPorDescripcion(partida.descripcion_original);
    }

    // Registrar SOLO los matches confiables
    let registradas = 0;
    if (matches.length) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const m of matches) {
          const fp = m.fecha_precio ? ` (precio ${fechaCorta(m.fecha_precio)})` : '';
          const obs = `Catálogo ${m.proveedor}${m.vigencia ? ' — ' + m.vigencia : ''}${fp}`;
          const ok = await registrarPrecioProveedor(conn, {
            solicitudId: req.params.id, proveedorId: m.proveedor_id, partidaId: partida.id,
            sku_proveedor: m.sku_proveedor, observaciones: obs, precio: m.precio_lista,
          });
          if (ok) registradas++;
        }
        await recalcularMejorPrecio(conn, partida.id, req.params.id);
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    res.json({
      ok: true,
      partida_id: partida.id,
      linea: partida.linea,
      registradas,
      matches,
      sugerencias,
    });
  } catch (err) { next(err); }
}

/**
 * Busca el precio de UNA partida en internet (IA + web search) y registra
 * automáticamente proveedor + precio + URL en el comentario. Respaldo del catálogo.
 * POST /solicitudes/:id/partidas/:pid/buscar-precio-web
 */
async function buscarPrecioWebPartida(req, res, next) {
  try {
    const [[partida]] = await pool.query(
      'SELECT * FROM solicitudes_partidas WHERE id = ? AND solicitud_id = ?',
      [req.params.pid, req.params.id]
    );
    if (!partida) return res.status(404).json({ error: 'Partida no encontrada' });

    // 1º consultar la base de conocimientos: si ya se buscó este producto en la web
    // y la búsqueda sigue VIGENTE, se reutiliza y NO se gasta otra búsqueda IA/web.
    let origen = 'web';
    let fechaBusqueda = null;
    let resultado = await cache.buscarEnCache(partida);
    if (resultado && resultado.ofertas.length) {
      origen = 'cache';
      fechaBusqueda = resultado.fecha_busqueda;
    } else {
      // No hay caché vigente → búsqueda web. Se hace ANTES de tomar conexión:
      // puede tardar 1-2 minutos y no debe bloquear el pool durante la búsqueda.
      resultado = await doBuscarPrecioWeb(partida);
      // Guardar para futuras búsquedas (no debe romper el flujo si falla).
      if (resultado.ofertas && resultado.ofertas.length) {
        try {
          await cache.guardarEnCache(partida, resultado.identificacion, resultado.ofertas);
        } catch (e) {
          console.warn('[precios.cache] no se pudo guardar la búsqueda:', e.message);
        }
      }
    }
    const { identificacion, ofertas } = resultado;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const oferta of ofertas) {
        // Buscar/crear proveedor con el nombre de la tienda (igual que bulkPartidas)
        let [[prov]] = await conn.query(
          `SELECT id FROM proveedores
           WHERE LOWER(TRIM(nombre_empresa)) = LOWER(TRIM(?)) LIMIT 1`,
          [oferta.tienda]
        );
        if (!prov) {
          const [r] = await conn.query(
            'INSERT INTO proveedores (nombre_empresa, activo) VALUES (?, 1)',
            [oferta.tienda.trim().substring(0, 150)]
          );
          prov = { id: r.insertId };
        }

        // sku_proveedor = referencia del fabricante; comentario = URL de la página
        const sku = identificacion.referencia_fabricante
          ? identificacion.referencia_fabricante.substring(0, 30) : null;
        const sello = origen === 'cache' ? `caché ${fechaCorta(fechaBusqueda)}` : null;
        const obs = [oferta.url, oferta.notas, sello].filter(Boolean).join(' — ');

        await registrarPrecioProveedor(conn, {
          solicitudId: req.params.id, proveedorId: prov.id, partidaId: partida.id,
          sku_proveedor: sku, observaciones: obs, precio: oferta.precio_mxn,
        });
      }

      if (ofertas.length > 0) await recalcularMejorPrecio(conn, partida.id, req.params.id);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    res.json({
      ok: true,
      partida_id: partida.id,
      linea: partida.linea,
      identificacion,
      ofertas,
      registradas: ofertas.length,
      origen,                 // 'cache' = reutilizado sin gastar búsqueda; 'web' = búsqueda nueva
      fecha_busqueda: origen === 'cache' ? fechaCorta(fechaBusqueda) : fechaCorta(new Date()),
    });
  } catch (err) { next(err); }
}

async function comparador(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM v_comparador_precios WHERE solicitud_id = ?',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

module.exports = {
  list, getById, create, update,
  parseExcel, parsePdf,
  bulkPartidas, addPartida, updatePartida, deletePartida,
  buscarPrecioCatalogoPartida,
  buscarPrecioWebPartida,
  comparador,
};
