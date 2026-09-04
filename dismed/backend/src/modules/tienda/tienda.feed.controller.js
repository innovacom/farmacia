/**
 * tienda.feed.controller.js — Feed de catálogo de productos para Meta
 * (Facebook/Instagram) y TikTok. Meta/TikTok descargan estas URLs por
 * calendario (sin OAuth) y arman su "Catálogo" para anuncios dinámicos.
 * Ver DISEÑO_ADS_META_TIKTOK.md.
 *
 *   GET /tienda/feed/meta.csv?token=...
 *   GET /tienda/feed/tiktok.csv?token=...
 *
 * Ambos comparten el mismo formato base (el de Google Merchant Center, que
 * Meta y TikTok aceptan) y el mismo generador de filas — un solo query.
 *
 * Reglas del feed:
 *  - Solo productos con activo=1 AND publicar_web=1 (igual que el catálogo).
 *  - Se EXCLUYEN automáticamente los que requieren receta
 *    (clasificacion_cofepris fuera de CLASIF_LIBRES) — no se anuncian
 *    medicamentos controlados. Es la misma condición que ya calcula
 *    `requiere_receta` en tienda.controller.js.
 *  - Se excluyen los marcados productos.excluir_ads = 1 (migrate_v71).
 *
 * Protección: token compartido (FEED_TOKEN) en la query string. Sin
 * FEED_TOKEN en el entorno, el feed responde 404 (desactivado).
 */
const { pool } = require('../../config/db');
const { resolverEmpresaUnica } = require('../../config/empresa');
const adsConfig = require('./tienda.ads.config');
const { decorarPrecios, CLASIF_LIBRES } = require('./tienda.controller');

const COLUMNAS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'gtin'];

function csvCampo(valor) {
  const s = valor == null ? '' : String(valor);
  // Comilla siempre: simplifica y es válido CSV. Escapa comillas internas.
  return `"${s.replace(/"/g, '""')}"`;
}

function baseUrl() {
  // Mismo dominio público que sirve el frontend y las imágenes (Apache
  // proxya /uploads al backend) — ver tienda.controller.js#sitemap.
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

/** Filas del feed (compartidas por Meta y TikTok). */
async function filasFeed() {
  const empresaId = await resolverEmpresaUnica();
  if (!empresaId) return [];

  const clasifPlaceholders = CLASIF_LIBRES.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT p.id, p.descripcion, p.descripcion_corta, p.imagen_url, p.precio_lista,
            p.fabricante, p.ean,
            COALESCE((SELECT SUM(l.cantidad_actual) FROM inventario_lotes l WHERE l.producto_id = p.id), 0) AS existencia
       FROM productos p
      WHERE p.activo = 1 AND p.publicar_web = 1
        AND p.excluir_ads = 0
        AND p.clasificacion_cofepris IN (${clasifPlaceholders})
      ORDER BY p.descripcion`,
    CLASIF_LIBRES
  );

  const conPrecio = await decorarPrecios(rows, empresaId);
  const base = baseUrl();

  return conPrecio
    .filter((r) => r.precio_final != null && Number(r.precio_final) > 0)
    .map((r) => ({
      id: r.id,
      title: r.descripcion,
      description: r.descripcion_corta || r.descripcion,
      availability: Number(r.existencia) > 0 ? 'in stock' : 'out of stock',
      condition: 'new',
      price: `${Number(r.precio_final).toFixed(2)} MXN`,
      link: `${base}/tienda/${r.id}`,
      image_link: r.imagen_url ? `${base}/uploads/productos/${r.imagen_url}` : '',
      brand: r.fabricante || '',
      gtin: r.ean || '',
    }));
}

function enviarCsv(res, filas) {
  const lineas = [COLUMNAS.join(',')];
  for (const f of filas) lineas.push(COLUMNAS.map((c) => csvCampo(f[c])).join(','));
  res.type('text/csv; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="feed.csv"');
  res.send(lineas.join('\n'));
}

function tokenValido(req) {
  const esperado = adsConfig.feedToken();
  if (!esperado) return false; // feed desactivado si no hay FEED_TOKEN
  return req.query.token === esperado;
}

async function metaCsv(req, res, next) {
  try {
    if (!tokenValido(req)) return res.sendStatus(404);
    enviarCsv(res, await filasFeed());
  } catch (err) { next(err); }
}

// TikTok acepta el mismo formato base; se deja endpoint aparte por si en el
// futuro difieren (ej. campos de "product_group_id" que solo pide TikTok).
async function tiktokCsv(req, res, next) {
  try {
    if (!tokenValido(req)) return res.sendStatus(404);
    enviarCsv(res, await filasFeed());
  } catch (err) { next(err); }
}

module.exports = { metaCsv, tiktokCsv };
