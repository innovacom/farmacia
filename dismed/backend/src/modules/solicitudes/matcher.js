/**
 * matcher.js — Motor de coincidencia descripción ↔ catálogo de productos.
 *
 * Filosofía (decisión de negocio):
 *   · Solo los códigos EXACTOS auto-vinculan (codigo_cliente confirmado, EAN).
 *     Eso lo resuelve el controlador al guardar; aquí también se devuelven con
 *     score 100 para que la UI los muestre arriba.
 *   · La similitud de DESCRIPCIÓN nunca auto-vincula: se devuelve como
 *     sugerencia con un score 0-100 para que el usuario confirme.
 *
 * Clave para no equivocar productos: los tokens de MEDIDA (números + unidad,
 * calibres, porcentajes) deben coincidir. Una jeringa de 5 ML jamás se sugiere
 * para una de 10 ML aunque el resto del texto sea idéntico.
 */
const { pool } = require('../../config/db');

// Abreviaturas frecuentes del giro médico → forma canónica
const ABREV = {
  JGA: 'JERINGA', JGAS: 'JERINGA', JER: 'JERINGA',
  AMP: 'AMPOLLETA', AMPS: 'AMPOLLETA', AMPULA: 'AMPOLLETA',
  TAB: 'TABLETA', TABS: 'TABLETA',
  CAP: 'CAPSULA', CAPS: 'CAPSULA',
  SOLN: 'SOLUCION', SOL: 'SOLUCION',
  INY: 'INYECTABLE',
  CJA: 'CAJA', CXC: 'CAJA',
  PZA: 'PIEZA', PZAS: 'PIEZA', PZ: 'PIEZA',
  FCO: 'FRASCO', FRA: 'FRASCO',
  GTE: 'GUANTE', GTES: 'GUANTE',
  EST: 'ESTERIL', ESTERILES: 'ESTERIL',
  DESECH: 'DESECHABLE', DESECHABLES: 'DESECHABLE',
};

const STOP = new Set([
  'DE', 'CON', 'PARA', 'EL', 'LA', 'LOS', 'LAS', 'Y', 'O', 'A', 'EN',
  'POR', 'UN', 'UNA', 'TIPO', 'MARCA', 'SU', 'SIN',
]);

// Unidades de medida que se "pegan" al número (orden: más largas primero)
const UNIT = 'MCG|MTS|PULG|ML|MG|MM|MT|KG|GR|CC|CM|UI|LT|UG|OZ|GA|FR|IN|M|G|L|U|%';
const RE_GLUE = new RegExp('(\\d+(?:[.\\/]\\d+)?)\\s+(' + UNIT + ')\\b', 'g');

function normalizar(texto) {
  if (!texto) return '';
  let t = String(texto)
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quitar acentos
    .replace(/[^A-Z0-9.%/]/g, ' ')                       // dejar letras, números, . % /
    .replace(/\s+/g, ' ')
    .trim();
  // "5 ML" → "5ML", "22 G" → "22G", "0.9 %" → "0.9%" (medida = un solo token)
  t = t.replace(RE_GLUE, '$1$2');
  t = t.split(' ').map((w) => ABREV[w] || w).join(' ');
  return t;
}

// Separa tokens de TEXTO (palabras) de tokens de MEDIDA (cualquiera con dígito)
function tokenizar(norm) {
  const palabras = norm.split(' ').filter(Boolean);
  const texto = [];
  const medidas = [];
  for (const w of palabras) {
    if (/\d/.test(w)) medidas.push(w);
    else if (!STOP.has(w) && w.length > 1) texto.push(w);
  }
  return { texto: [...new Set(texto)], medidas: [...new Set(medidas)] };
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Score 0..1 entre los tokens de la consulta y la descripción de un producto.
 * Devuelve -1 (descartar) si una medida de la consulta NO está en el producto.
 */
function score(qTokens, prodNorm) {
  const pTokens = tokenizar(prodNorm);
  const simTexto = jaccard(qTokens.texto, pTokens.texto);

  let medScore;
  if (qTokens.medidas.length === 0) {
    medScore = 0.5; // neutro: no hay medidas que validar
  } else if (pTokens.medidas.length === 0) {
    medScore = 0;   // la consulta tiene medidas y el producto ninguna → débil, no descarta
  } else {
    const setP = new Set(pTokens.medidas);
    const enConflicto = qTokens.medidas.some((m) => !setP.has(m));
    if (enConflicto) return -1; // medida distinta → NO es el mismo producto
    medScore = 1;
  }
  return 0.6 * simTexto + 0.4 * medScore;
}

/**
 * Busca candidatos del catálogo para una descripción/código.
 * @returns [{ id, sku_interno, descripcion, fabricante, unidad_medida,
 *             precio_lista, ean, score (0-100), match_reason }]
 */
async function buscarCandidatos({
  q, descripcion, cliente_id, codigo_cliente, codigo_gobierno, limit = 10,
}) {
  const resultados = [];
  const vistos = new Set();
  const push = (row, sc01, reason) => {
    if (vistos.has(row.id)) return;
    vistos.add(row.id);
    resultados.push({
      id: row.id,
      sku_interno: row.sku_interno,
      descripcion: row.descripcion,
      fabricante: row.fabricante || null,
      unidad_medida: row.unidad_medida,
      precio_lista: row.precio_lista,
      ean: row.ean || null,
      score: Math.max(0, Math.round(sc01 * 100)),
      match_reason: reason,
    });
  };

  // ── C1: codigo_cliente exacto en el diccionario del cliente ──
  if (cliente_id && codigo_cliente) {
    const [rows] = await pool.query(
      `SELECT p.*, cs.confirmado FROM clientes_skus cs
       JOIN productos p ON p.id = cs.producto_id
       WHERE cs.cliente_id = ? AND cs.sku_cliente = ? AND p.activo = 1`,
      [cliente_id, codigo_cliente]
    );
    for (const r of rows) {
      push(r, 1, r.confirmado ? 'codigo_cliente' : 'codigo_cliente_sugerido');
    }
  }

  // ── C2: EAN/código de barras (8-14 dígitos) detectado en el texto ──
  const blob = `${q || ''} ${descripcion || ''} ${codigo_cliente || ''} ${codigo_gobierno || ''}`;
  const eans = [...new Set(blob.match(/\b\d{8,14}\b/g) || [])];
  if (eans.length) {
    const [rows] = await pool.query(
      'SELECT * FROM productos WHERE activo = 1 AND ean IN (?)', [eans]
    );
    for (const r of rows) push(r, 1, 'ean');
  }

  // ── C3: clave de cuadro básico / gobierno (exacta → auto-vincula) ──
  if (codigo_gobierno && String(codigo_gobierno).trim()) {
    try {
      const clave = String(codigo_gobierno).trim();
      const [rows] = await pool.query(
        'SELECT * FROM productos WHERE activo = 1 AND clave_cuadro_basico = ?', [clave]
      );
      for (const r of rows) push(r, 1, 'codigo_gobierno');
    } catch (_) { /* columna aún no existe (migración pendiente) */ }
  }

  // ── C4/C5: similitud de descripción (sugerencia, nunca auto-vincula) ──
  const texto = (q && q.trim()) || descripcion || '';
  if (texto.trim()) {
    const norm = normalizar(texto);
    const qTokens = tokenizar(norm);
    const tokensBusqueda = [...qTokens.texto].sort((a, b) => b.length - a.length).slice(0, 4);

    // Recuperar candidatos: FULLTEXT sobre descripcion_norm (rápido y rankea);
    // si no hay índice/columna o no devuelve nada, se cae a LIKE.
    let rows = [];
    const ftQuery = [...qTokens.texto, ...qTokens.medidas].join(' ').trim();
    if (ftQuery) {
      try {
        [rows] = await pool.query(
          `SELECT * FROM productos p
           WHERE p.activo = 1
             AND MATCH(p.descripcion_norm) AGAINST (? IN NATURAL LANGUAGE MODE)
           LIMIT 80`,
          [ftQuery]
        );
      } catch (_) { rows = []; /* sin índice FULLTEXT: usar LIKE */ }
    }

    if (!rows.length) {
      // Respaldo LIKE (sku + tokens de texto más significativos)
      const conds = ['p.sku_interno LIKE ?', 'p.descripcion LIKE ?'];
      const vals = [`%${texto.trim()}%`, `%${texto.trim()}%`];
      for (const tk of tokensBusqueda) { conds.push('p.descripcion LIKE ?'); vals.push(`%${tk}%`); }
      [rows] = await pool.query(
        `SELECT * FROM productos p WHERE p.activo = 1 AND (${conds.join(' OR ')}) LIMIT 80`,
        vals
      );
    }

    // Umbral: búsqueda directa del usuario (q) muestra todo; auto-sugerencia es más estricta
    const threshold = (q && q.trim()) ? 0 : 0.2;
    for (const r of rows) {
      let sc = score(qTokens, normalizar(r.descripcion));
      if (sc < 0) continue; // descartado por medida en conflicto
      // Coincidencia literal de lo tecleado → asegúrale visibilidad en búsqueda directa
      const ndesc = normalizar(r.descripcion);
      const skuUp = (r.sku_interno || '').toUpperCase();
      if (ndesc.includes(norm) || skuUp.includes(texto.trim().toUpperCase())) {
        sc = Math.max(sc, 0.5);
      }
      if (sc < threshold) continue;
      push(r, sc, 'descripcion');
    }
  }

  resultados.sort((a, b) => b.score - a.score);
  return resultados.slice(0, limit);
}

module.exports = { normalizar, tokenizar, score, buscarCandidatos };
