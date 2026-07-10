/**
 * precios.cache.js — Base de conocimientos de búsquedas web de precios.
 *
 * Objetivo: NO repetir búsquedas web (IA/Gemini) de un producto que ya se buscó.
 * Cada vez que se busca un precio en internet se guardan las ofertas en
 * `precios_web_cache`. Antes de volver a buscar en la web, `buscarPrecioWebPartida`
 * consulta aquí: si ya hay una búsqueda VIGENTE (dentro de la ventana de validez,
 * por defecto 11 meses) se reutilizan esos precios sin gastar otra búsqueda.
 *
 * La recuperación es por descripción normalizada (misma normalización del matcher)
 * o por código de gobierno/cliente exacto.
 */
const { pool } = require('../../config/db');
const { normalizar } = require('./matcher');
const { getVigencias } = require('../../config/precios');

function claveBusqueda(texto) {
  return normalizar(texto || '').substring(0, 255);
}

function ymd(fecha) {
  if (fecha instanceof Date) return fecha.toISOString().slice(0, 10);
  return String(fecha).slice(0, 10);
}

/**
 * Busca en la caché una búsqueda web previa VIGENTE para esta partida.
 * @returns {{ identificacion, ofertas, fecha_busqueda }|null}
 */
async function buscarEnCache(partida) {
  const clave = claveBusqueda(partida.descripcion_original);
  const codigos = [partida.codigo_gobierno, partida.codigo_cliente]
    .map((c) => (c || '').toString().trim()).filter(Boolean);

  const ors = [];
  const vals = [];
  if (clave) { ors.push('clave_busqueda = ?'); vals.push(clave); }
  if (codigos.length) {
    ors.push('codigo_gobierno IN (?)', 'codigo_cliente IN (?)');
    vals.push(codigos, codigos);
  }
  if (!ors.length) return null;

  const { vigencia_web_meses } = await getVigencias();
  const [rows] = await pool.query(
    `SELECT * FROM precios_web_cache
      WHERE (${ors.join(' OR ')})
        AND fecha_busqueda >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
      ORDER BY fecha_busqueda DESC, precio_mxn ASC`,
    [...vals, vigencia_web_meses]
  );
  if (!rows.length) return null;

  // Tomar el lote de la búsqueda más reciente (misma fecha_busqueda que la fila top).
  const fechaTop = ymd(rows[0].fecha_busqueda);
  const lote = rows.filter((r) => ymd(r.fecha_busqueda) === fechaTop);

  // Deduplicar por tienda+url y limitar a 3 (igual que la búsqueda web original).
  const vistas = new Set();
  const ofertas = [];
  for (const r of lote) {
    const k = `${r.tienda}|${r.url}`;
    if (vistas.has(k)) continue;
    vistas.add(k);
    ofertas.push({
      tienda: r.tienda,
      url: r.url,
      precio_mxn: Number(r.precio_mxn),
      notas: r.notas || '',
    });
    if (ofertas.length >= 3) break;
  }

  const ref = lote[0];
  return {
    identificacion: {
      producto: ref.producto_identificado || '',
      referencia_fabricante: ref.referencia_fabricante || '',
      clave_cuadro_basico: ref.clave_cuadro_basico || '',
      confianza: 'media',
    },
    ofertas,
    fecha_busqueda: fechaTop,
  };
}

/**
 * Guarda las ofertas de una búsqueda web para reutilizarlas en el futuro.
 * Una fila por oferta. fecha_busqueda = hoy.
 */
async function guardarEnCache(partida, identificacion, ofertas) {
  if (!ofertas || !ofertas.length) return;
  const clave = claveBusqueda(partida.descripcion_original);
  const ident = identificacion || {};

  const placeholders = [];
  const params = [];
  for (const o of ofertas) {
    placeholders.push('(?,?,?,?,?,?,?,?,?,?,?,?,CURDATE())');
    params.push(
      clave,
      (partida.descripcion_original || '').toString().substring(0, 800) || null,
      (partida.codigo_cliente || '').toString().substring(0, 60) || null,
      (partida.codigo_gobierno || '').toString().substring(0, 60) || null,
      (ident.producto || '').toString().substring(0, 400) || null,
      (ident.referencia_fabricante || '').toString().substring(0, 80) || null,
      (ident.clave_cuadro_basico || '').toString().substring(0, 60) || null,
      (o.tienda || '').toString().substring(0, 150),
      (o.url || '').toString().substring(0, 700),
      Number(o.precio_mxn) || 0,
      (o.notas || '').toString().substring(0, 500) || null,
      'MXN'
    );
  }

  await pool.query(
    `INSERT INTO precios_web_cache
       (clave_busqueda, descripcion_original, codigo_cliente, codigo_gobierno,
        producto_identificado, referencia_fabricante, clave_cuadro_basico,
        tienda, url, precio_mxn, notas, moneda, fecha_busqueda)
     VALUES ${placeholders.join(',')}`,
    params
  );
}

module.exports = { buscarEnCache, guardarEnCache, claveBusqueda };
