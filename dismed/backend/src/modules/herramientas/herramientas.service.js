/**
 * herramientas.service.js — Importación / exportación tabular de catálogos por
 * proveedor y equivalencias SKU proveedor ↔ INNOVACOM.
 *
 * Fuente única de la lógica: la usan tanto los endpoints web (herramientas.controller)
 * como el CLI (import_pronamac_cli.js). El proveedor YA NO está amarrado: cada renglón
 * trae una columna PROVEEDOR (nombre o ID) y se resuelve/crea por archivo.
 *
 * Layouts (mapeo por NOMBRE de encabezado, tolerante a acentos/mayúsculas/espacios):
 *   Catálogo:     PROVEEDOR | SKU PROVEEDOR | DESCRIPCION | REFERENCIA FABRICANTE | UNIDAD MEDIDA | PRECIO | [VIGENCIA]
 *   Equivalencias: PROVEEDOR | SKU PROVEEDOR | SKU INNOVACOM
 */
const xlsx = require('xlsx');
const crypto = require('crypto');
const { pool } = require('../../config/db');

// ── Helpers de normalización ────────────────────────────────────────────────
const norm = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const upper = (s) =>
  norm(s).toUpperCase()
    .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E').replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O').replace(/[ÚÙÜÛ]/g, 'U').replace(/Ñ/g, 'N');
const numPrecio = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isNaN(n) ? null : n;
};

// Llave sintética DETERMINÍSTICA para proveedores que no manejan código propio.
// Se deriva del contenido del renglón, así reimportar el mismo archivo ACTUALIZA
// en vez de duplicar (la PK es (proveedor_id, sku_proveedor)). Cabe en VARCHAR(40).
const hash8 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 8).toUpperCase();
function claveSintetica(tipo, obj) {
  let base;
  if (tipo === 'equivalencias') {
    base = upper(obj.sku_innovacom || ''); // la equivalencia gira en torno al SKU INNOVACOM
  } else {
    base = [obj.descripcion, obj.referencia_fabricante, obj.unidad_medida]
      .map((x) => upper(x || '')).join('|');
  }
  if (!base.replace(/\|/g, '')) base = JSON.stringify(obj); // nada estable → toda la fila
  return 'GEN-' + hash8(base);
}

// ── Definición de columnas por tipo de archivo ──────────────────────────────
// equals: coincidencia exacta (prioridad); includes: subcadena; excludes: descarta.
const COLS = {
  catalogo: [
    { campo: 'proveedor', etiqueta: 'Proveedor (nombre o ID)', requerido: true,
      equals: ['PROVEEDOR', 'CODIGO PROVEEDOR', 'COD PROVEEDOR', 'CLAVE PROVEEDOR'],
      includes: ['PROVEEDOR'], excludes: ['SKU'] },
    { campo: 'sku', etiqueta: 'SKU del proveedor (se genera si viene vacío)', requerido: false,
      equals: ['SKU PROVEEDOR', 'SKU', 'CODIGO', 'CLAVE'],
      includes: ['SKU', 'CODIGO'], excludes: ['INNOVACOM'] },
    { campo: 'descripcion', etiqueta: 'Descripción', requerido: false,
      includes: ['DESCRIPCION'] },
    { campo: 'referencia_fabricante', etiqueta: 'Referencia fabricante', requerido: false,
      equals: ['REFERENCIA FABRICANTE', 'REFERENCIA', 'REF FABRICANTE', 'REF FAB'],
      includes: ['REFERENCIA', 'REF FAB'] },
    { campo: 'fabricante', etiqueta: 'Fabricante', requerido: false,
      equals: ['FABRICANTE', 'MARCA'],
      includes: ['FABRICANTE', 'MARCA'], excludes: ['REFERENCIA', 'REF'] },
    { campo: 'unidad_medida', etiqueta: 'Unidad de medida', requerido: false,
      includes: ['UNIDAD', 'U MEDIDA'] },
    { campo: 'precio_lista', etiqueta: 'Precio de lista', requerido: false,
      includes: ['PRECIO', 'COSTO'] },
    { campo: 'vigencia', etiqueta: 'Vigencia', requerido: false,
      includes: ['VIGENCIA', 'PERIODO'] },
  ],
  equivalencias: [
    { campo: 'proveedor', etiqueta: 'Proveedor (nombre o ID)', requerido: true,
      equals: ['PROVEEDOR', 'CODIGO PROVEEDOR', 'COD PROVEEDOR', 'CLAVE PROVEEDOR'],
      includes: ['PROVEEDOR'], excludes: ['SKU'] },
    { campo: 'sku', etiqueta: 'SKU del proveedor (se genera si viene vacío)', requerido: false,
      equals: ['SKU PROVEEDOR', 'SKU', 'CODIGO', 'CLAVE'],
      includes: ['SKU', 'CODIGO'], excludes: ['INNOVACOM'] },
    { campo: 'sku_innovacom', etiqueta: 'SKU INNOVACOM', requerido: true,
      equals: ['SKU INNOVACOM', 'INNOVACOM', 'SKU INTERNO'],
      includes: ['INNOVACOM', 'INTERNO'] },
  ],
};

function findCol(heads, def) {
  for (const e of def.equals || []) {
    const i = heads.indexOf(e);
    if (i >= 0) return i;
  }
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    if ((def.includes || []).some((s) => h.includes(s)) &&
        !(def.excludes || []).some((s) => h.includes(s))) return i;
  }
  return -1;
}

/**
 * Lee la 1ª hoja de un xlsx/csv y mapea columnas según el layout `tipo`.
 * Devuelve { columnas, filas, totalFilas, sinSku } sin tocar la BD.
 */
function parseArchivo(filePath, tipo) {
  const defs = COLS[tipo];
  if (!defs) throw new Error(`Tipo de archivo no soportado: ${tipo}`);

  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('El archivo no tiene hojas legibles');
  const aoa = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  const headerRow = (aoa[0] || []).map((h) => upper(h));

  const idx = {};
  const columnas = defs.map((def) => {
    const i = findCol(headerRow, def);
    idx[def.campo] = i;
    return {
      campo: def.campo,
      etiqueta: def.etiqueta,
      requerido: def.requerido,
      presente: i >= 0,
      encabezado_detectado: i >= 0 ? norm((aoa[0] || [])[i]) : null,
      ejemplo: null,
    };
  });

  const filas = [];
  let clavesGeneradas = 0;
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.every((c) => c == null || c === '')) continue;
    const obj = {};
    for (const def of defs) {
      const i = idx[def.campo];
      obj[def.campo] = i >= 0 ? norm(row[i]) || null : null;
    }
    if (obj.precio_lista !== undefined) obj.precio_lista = numPrecio(obj.precio_lista);
    if (!obj.sku) {                       // proveedor sin código → llave determinística
      obj.sku = claveSintetica(tipo, obj);
      obj.skuGenerado = true;
      clavesGeneradas++;
    }
    filas.push(obj);
  }

  // Ejemplos para la vista previa (primer valor no vacío de cada columna).
  for (const col of columnas) {
    if (!col.presente) continue;
    const ej = filas.find((f) => f[col.campo] != null);
    col.ejemplo = ej ? String(ej[col.campo]) : null;
  }

  return { columnas, filas, totalFilas: filas.length, clavesGeneradas };
}

// ── Resolución de proveedor por archivo ─────────────────────────────────────
async function cargarMapaProveedores(conn) {
  const [rows] = await conn.query('SELECT id, nombre_empresa FROM proveedores');
  const porId = new Map();
  const porNombre = new Map();
  for (const r of rows) {
    porId.set(String(r.id), r.id);
    porNombre.set(upper(r.nombre_empresa), r.id);
  }
  return { porId, porNombre };
}

async function resolverProveedor(conn, mapa, valor, { crear }) {
  const v = norm(valor);
  if (!v) return { id: null, creado: false };
  if (/^\d+$/.test(v) && mapa.porId.has(v)) return { id: mapa.porId.get(v), creado: false };
  const key = upper(v);
  if (mapa.porNombre.has(key)) return { id: mapa.porNombre.get(key), creado: false };
  if (!crear) return { id: null, creado: true }; // se crearía
  const [r] = await conn.query('INSERT INTO proveedores (nombre_empresa, activo) VALUES (?, 1)', [v]);
  mapa.porId.set(String(r.insertId), r.insertId);
  mapa.porNombre.set(key, r.insertId);
  return { id: r.insertId, creado: true };
}

/**
 * Previsualiza (dry-run): no toca la BD. Reporta columnas, muestra y estadísticas
 * incluyendo cuántos proveedores se crearían.
 */
async function previsualizar(filePath, tipo) {
  const { columnas, filas, totalFilas, clavesGeneradas } = parseArchivo(filePath, tipo);
  const faltantes = columnas.filter((c) => c.requerido && !c.presente).map((c) => c.etiqueta);

  const conn = await pool.getConnection();
  let provNuevos = 0;
  const provVistos = new Set();
  try {
    const mapa = await cargarMapaProveedores(conn);
    for (const f of filas) {
      const key = upper(f.proveedor);
      if (!key || provVistos.has(key)) continue;
      provVistos.add(key);
      const { id, creado } = await resolverProveedor(conn, mapa, f.proveedor, { crear: false });
      if (creado || !id) provNuevos++;
    }
  } finally {
    conn.release();
  }

  const muestra = filas.slice(0, 10);
  const stats = {
    totalFilas,
    clavesGeneradas,
    proveedoresDistintos: provVistos.size,
    proveedoresNuevos: provNuevos,
  };
  if (tipo === 'catalogo') {
    stats.conPrecio = filas.filter((f) => f.precio_lista != null).length;
  }
  return { tipo, columnas, faltantes, muestra, stats };
}

/** Importa un catálogo. Cada renglón resuelve/crea su proveedor por la columna PROVEEDOR. */
async function importarCatalogo(filePath, { vigenciaDefault = null } = {}) {
  const { columnas, filas } = parseArchivo(filePath, 'catalogo');
  const faltantes = columnas.filter((c) => c.requerido && !c.presente).map((c) => c.etiqueta);
  if (faltantes.length) throw new Error(`Faltan columnas obligatorias: ${faltantes.join(', ')}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const mapa = await cargarMapaProveedores(conn);

    // Mapa sku_interno → producto_id (por si el archivo trae SKU INNOVACOM inline).
    const [prods] = await conn.query('SELECT id, sku_interno FROM productos');
    const prodMap = new Map();
    for (const p of prods) prodMap.set(upper(p.sku_interno), p.id);

    let insertados = 0, actualizados = 0, provNuevos = 0, omitidos = 0;
    for (const f of filas) {
      const { id: proveedorId, creado } = await resolverProveedor(conn, mapa, f.proveedor, { crear: true });
      if (!proveedorId) { omitidos++; continue; }
      if (creado) provNuevos++;

      let producto_id = null, match_estado = 'sin_vincular';
      if (f.sku_innovacom) {
        producto_id = prodMap.get(upper(f.sku_innovacom)) || null;
        match_estado = producto_id ? 'confirmado' : 'sugerido';
      }
      const [r] = await conn.query(
        `INSERT INTO proveedores_catalogo
           (proveedor_id, sku_proveedor, referencia_fabricante, fabricante, descripcion, unidad_medida,
            precio_lista, vigencia, fecha_precio, sku_innovacom, producto_id, match_estado)
         VALUES (?,?,?,?,?,?,?,?,CURDATE(),?,?,?)
         ON DUPLICATE KEY UPDATE
           referencia_fabricante = VALUES(referencia_fabricante),
           fabricante            = VALUES(fabricante),
           descripcion           = VALUES(descripcion),
           unidad_medida         = VALUES(unidad_medida),
           precio_lista          = VALUES(precio_lista),
           vigencia              = VALUES(vigencia),
           fecha_precio          = CURDATE(),
           sku_innovacom         = COALESCE(VALUES(sku_innovacom), sku_innovacom),
           producto_id           = COALESCE(VALUES(producto_id), producto_id),
           match_estado          = VALUES(match_estado)`,
        [proveedorId, f.sku, f.referencia_fabricante, f.fabricante, f.descripcion,
         f.unidad_medida ? upper(f.unidad_medida) : null,
         f.precio_lista, f.vigencia || vigenciaDefault, f.sku_innovacom || null,
         producto_id, match_estado]
      );
      r.affectedRows === 1 ? insertados++ : actualizados++;
    }

    await conn.commit();
    return { insertados, actualizados, proveedoresNuevos: provNuevos, omitidos, total: filas.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Importa equivalencias SKU proveedor ↔ INNOVACOM (upsert por proveedor+sku). */
async function importarEquivalencias(filePath) {
  const { columnas, filas } = parseArchivo(filePath, 'equivalencias');
  const faltantes = columnas.filter((c) => c.requerido && !c.presente).map((c) => c.etiqueta);
  if (faltantes.length) throw new Error(`Faltan columnas obligatorias: ${faltantes.join(', ')}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const mapa = await cargarMapaProveedores(conn);
    const [prods] = await conn.query('SELECT id, sku_interno FROM productos');
    const prodMap = new Map();
    for (const p of prods) prodMap.set(upper(p.sku_interno), p.id);

    let actualizados = 0, insertados = 0, vinculados = 0, sugeridos = 0, provNuevos = 0, omitidos = 0;
    for (const f of filas) {
      if (!f.sku_innovacom) { omitidos++; continue; }
      const { id: proveedorId, creado } = await resolverProveedor(conn, mapa, f.proveedor, { crear: true });
      if (!proveedorId) { omitidos++; continue; }
      if (creado) provNuevos++;

      const producto_id = prodMap.get(upper(f.sku_innovacom)) || null;
      const match_estado = producto_id ? 'confirmado' : 'sugerido';
      const [r] = await conn.query(
        `INSERT INTO proveedores_catalogo
           (proveedor_id, sku_proveedor, sku_innovacom, producto_id, match_estado)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           sku_innovacom = VALUES(sku_innovacom),
           producto_id   = VALUES(producto_id),
           match_estado  = VALUES(match_estado)`,
        [proveedorId, f.sku, f.sku_innovacom, producto_id, match_estado]
      );
      r.affectedRows === 1 ? insertados++ : actualizados++;
      producto_id ? vinculados++ : sugeridos++;
    }

    await conn.commit();
    return { insertados, actualizados, vinculados, sugeridos, proveedoresNuevos: provNuevos, omitidos, total: filas.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ── Exportación / plantillas ────────────────────────────────────────────────
const HEADERS = {
  catalogo: ['PROVEEDOR', 'SKU PROVEEDOR', 'DESCRIPCION', 'REFERENCIA FABRICANTE', 'FABRICANTE', 'UNIDAD MEDIDA', 'PRECIO', 'VIGENCIA'],
  equivalencias: ['PROVEEDOR', 'SKU PROVEEDOR', 'SKU INNOVACOM'],
};

function aoaToBuffer(aoa, sheetName) {
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, sheetName);
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Plantilla de ejemplo (encabezados + 2 renglones de muestra). */
function plantilla(tipo) {
  if (!HEADERS[tipo]) throw new Error(`Tipo no soportado: ${tipo}`);
  const ejemplos = {
    catalogo: [
      ['PRONAMAC', 'AMB 091', 'Cánula nasal adulto', '2001010', 'Ambu', 'PIEZA', 12.50, 'JUNIO 2026'],
      ['DEGASA', 'DG-1200', 'Gasa estéril 10x10', 'MN1616', 'Degasa', 'CAJA', 85.00, 'JUNIO 2026'],
    ],
    equivalencias: [
      ['PRONAMAC', 'AMB 091', 'DM-00001'],
      ['DEGASA', 'DG-1200', 'DM-00042'],
    ],
  };
  return aoaToBuffer([HEADERS[tipo], ...ejemplos[tipo]], tipo === 'catalogo' ? 'Catalogo' : 'Equivalencias');
}

/** Exporta catálogo (opcionalmente filtrado por proveedor) en el layout de import. */
async function exportarCatalogo(proveedorId = null) {
  const where = [];
  const vals = [];
  if (proveedorId) { where.push('pc.proveedor_id = ?'); vals.push(proveedorId); }
  const [rows] = await pool.query(
    `SELECT p.nombre_empresa, pc.sku_proveedor, pc.descripcion, pc.referencia_fabricante,
            pc.fabricante, pc.unidad_medida, pc.precio_lista, pc.vigencia
       FROM proveedores_catalogo pc
       JOIN proveedores p ON p.id = pc.proveedor_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.nombre_empresa, pc.sku_proveedor`,
    vals
  );
  const aoa = [HEADERS.catalogo, ...rows.map((r) => [
    r.nombre_empresa, r.sku_proveedor, r.descripcion, r.referencia_fabricante,
    r.fabricante, r.unidad_medida, r.precio_lista, r.vigencia,
  ])];
  return aoaToBuffer(aoa, 'Catalogo');
}

/** Exporta equivalencias (solo renglones con SKU INNOVACOM) en el layout de import. */
async function exportarEquivalencias(proveedorId = null) {
  const where = ['pc.sku_innovacom IS NOT NULL'];
  const vals = [];
  if (proveedorId) { where.push('pc.proveedor_id = ?'); vals.push(proveedorId); }
  const [rows] = await pool.query(
    `SELECT p.nombre_empresa, pc.sku_proveedor, pc.sku_innovacom
       FROM proveedores_catalogo pc
       JOIN proveedores p ON p.id = pc.proveedor_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.nombre_empresa, pc.sku_proveedor`,
    vals
  );
  const aoa = [HEADERS.equivalencias, ...rows.map((r) => [
    r.nombre_empresa, r.sku_proveedor, r.sku_innovacom,
  ])];
  return aoaToBuffer(aoa, 'Equivalencias');
}

module.exports = {
  parseArchivo, previsualizar,
  importarCatalogo, importarEquivalencias,
  plantilla, exportarCatalogo, exportarEquivalencias,
  HEADERS, COLS,
};
