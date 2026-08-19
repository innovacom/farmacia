/**
 * tienda.controller.js — Catálogo público de la farmacia (sin login, ver
 * memoria project_tienda_web_farmacia / plan de 4 entregas). Entrega 1: solo
 * lectura + botón "Pedir por WhatsApp" (deep link wa.me), que cae directo al
 * carrito conversacional que ya existe en whatsapp.carrito.service.js — este
 * módulo NO crea pedidos ni toca inventario.
 *
 * Solo expone productos con `publicar_web = 1` (bandera propia, distinta de
 * `vendible` que gobierna el mostrador/POS — un producto puede venderse en
 * mostrador sin listarse públicamente).
 *
 * Precio: mismo resolver que el mostrador (pos.promociones.service#descuentosPara,
 * el que usa pos.ventas.service y whatsapp.carrito.service) — el catálogo público
 * debe cobrar/mostrar EXACTAMENTE lo mismo que se cobra en caja, promociones
 * vigentes incluidas. `empresaId` se infiere con resolverEmpresaUnica()
 * (config/empresa.js) porque esta ruta no tiene auth (mismo problema que el
 * webhook de WhatsApp: no hay req.user de dónde tomarlo).
 *
 * Existencia: suma cruda de inventario_lotes sin distinguir almacén/sucursal
 * (suficiente para un "hay/no hay" público; mismo nivel de detalle que ve el
 * cliente por WhatsApp).
 *
 * `info()` además entrega identidad/branding (logo, lema, redes — vía
 * branding.service#getBranding, empresas_config claves tienda_*) y el pie de
 * página (sucursales con `publicar_web=1`, dirección/teléfono/horario/mapa).
 */
const { pool } = require('../../config/db');
const { resolverEmpresaUnica } = require('../../config/empresa');
const promociones = require('../pos/pos.promociones.service');
const branding = require('../../services/branding.service');
const stripeConfig = require('./tienda.stripe.config');

// Misma lista que whatsapp.carrito.service#CLASIF_LIBRES / pos.ventas.service —
// si el producto no está aquí, se muestra "requiere receta médica".
const CLASIF_LIBRES = ['libre', 'venta_farmacia'];

// Igual que pos.ventas.service#decorarPromos: precio_final es precio_lista con
// la promoción vigente aplicada (si hay), redondeado a centavos. Sin empresaId
// resuelto (instancia recién provisionada, sin usuarios activos) no hay
// promociones que consultar — se regresa precio_lista tal cual.
async function decorarPrecios(rows, empresaId) {
  const base = rows.map((r) => ({
    ...r,
    precio_final: r.precio_lista != null ? Number(r.precio_lista) : null,
    descuento_pct: null,
    promocion_nombre: null,
  }));
  if (!empresaId || !rows.length) return base;
  const promos = await promociones.descuentosPara(pool, empresaId, rows.map((r) => r.id));
  return base.map((r) => {
    const promo = promos.get(r.id);
    if (!promo || r.precio_lista == null) return r;
    const precioFinal = Math.round(Number(r.precio_lista) * (1 - promo.pct / 100) * 100) / 100;
    return { ...r, precio_final: precioFinal, descuento_pct: promo.pct, promocion_nombre: promo.nombre };
  });
}

// Embed sin API key: maps.google.com/maps?q=...&output=embed es la variante
// pública clásica. La Maps Embed API oficial exige key + cuenta de
// facturación y no se justifica sólo para pintar un pin fijo.
function mapaEmbed(lat, lng) {
  if (lat == null || lng == null) return null;
  return `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`;
}

/**
 * GET /tienda/info — identidad del tenant + sucursales publicadas con su
 * horario, para el encabezado y el pie del catálogo. Antes venía de ENV
 * (EMPRESA_NOMBRE / TIENDA_WHATSAPP_NUMERO); ahora la fuente es la BD
 * (empresas + empresas_config vía branding.service, y sucursales) — ENV
 * queda sólo de respaldo si no hay empresa resuelta (instancia recién
 * provisionada, sin usuarios activos). TIENDA_WHATSAPP_NUMERO se queda en
 * ENV a propósito: es config de instancia de despliegue, no branding de
 * tenant.
 */
async function info(req, res, next) {
  try {
    const empresaId = await resolverEmpresaUnica();
    if (!empresaId) {
      return res.json({
        nombre: process.env.EMPRESA_NOMBRE || 'Farmacia',
        razon_social: null,
        logo_url: null,
        lema: null,
        subtitulo: null,
        whatsapp: process.env.TIENDA_WHATSAPP_NUMERO || null,
        redes: { facebook: null, instagram: null, email: null },
        pago_habilitado: false,
        envio_domicilio_costo: 0,
        sucursales: [],
      });
    }

    const b = await branding.getBranding(empresaId);

    const [sucursales] = await pool.query(
      `SELECT id, nombre, direccion, telefono, latitud, longitud,
              responsable_sanitario, cedula_responsable_sanitario, licencia_sanitaria
         FROM sucursales
        WHERE empresa_id = ? AND activo = 1 AND publicar_web = 1
        ORDER BY nombre`,
      [empresaId]
    );

    // Un solo query para los horarios de todas las sucursales publicadas
    // (evita N+1). Sin sucursales publicadas no se consulta nada.
    let horarios = [];
    if (sucursales.length) {
      const ids = sucursales.map((s) => s.id);
      [horarios] = await pool.query(
        `SELECT sucursal_id, dia_semana, hora_inicio, hora_fin, cerrado
           FROM sucursal_horarios
          WHERE sucursal_id IN (?) ORDER BY dia_semana, hora_inicio`,
        [ids]
      );
    }

    res.json({
      nombre: b.nombre_comercial,
      razon_social: b.nombre,
      logo_url: b.logo_url,
      lema: b.config.tienda_lema || null,
      subtitulo: b.config.tienda_subtitulo || null,
      whatsapp: process.env.TIENDA_WHATSAPP_NUMERO || null,
      redes: {
        facebook: b.config.tienda_facebook || null,
        instagram: b.config.tienda_instagram || null,
        email: b.config.tienda_email || null,
      },
      // Fase 4: oculta por completo el carrito/checkout en el frontend
      // (no solo el botón "Pagar") cuando Stripe no está configurado —
      // mismo criterio que TIENDA_WHATSAPP_NUMERO oculta su botón.
      pago_habilitado: stripeConfig.estaConfigurado(),
      envio_domicilio_costo: Number(b.config.tienda_envio_domicilio_costo || 0),
      // Solo booleanos de disponibilidad, no el texto completo — el texto
      // largo (privacidad/términos) se pide aparte vía GET /tienda/legal,
      // que solo llaman las dos páginas legales, no cada carga de /tienda.
      legal: {
        politica_envios: b.config.tienda_politica_envios || null,
        formas_pago: b.config.tienda_formas_pago || null,
        leyenda_medicamentos: b.config.tienda_leyenda_medicamentos || null,
        privacidad_disponible: !!b.config.tienda_aviso_privacidad,
        terminos_disponible: !!b.config.tienda_terminos,
      },
      sucursales: sucursales.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        direccion: s.direccion,
        telefono: s.telefono,
        mapa_embed_url: mapaEmbed(s.latitud, s.longitud),
        responsable_sanitario: s.responsable_sanitario || null,
        cedula_responsable_sanitario: s.cedula_responsable_sanitario || null,
        licencia_sanitaria: s.licencia_sanitaria || null,
        horarios: horarios
          .filter((h) => h.sucursal_id === s.id)
          .map(({ dia_semana, hora_inicio, hora_fin, cerrado }) =>
            ({ dia_semana, hora_inicio, hora_fin, cerrado: !!cerrado })),
      })),
    });
  } catch (err) { next(err); }
}

const LEGAL_TITULOS = { privacidad: 'Aviso de privacidad', terminos: 'Términos y condiciones' };
const LEGAL_CLAVES = { privacidad: 'tienda_aviso_privacidad', terminos: 'tienda_terminos' };

/**
 * GET /tienda/legal?tipo=privacidad|terminos — texto completo de una de las
 * dos páginas legales (dismed/frontend/src/pages/Tienda/PaginaLegal.jsx).
 * Separado de info() a propósito: el texto es largo (hasta 6000 caracteres)
 * y solo lo necesitan estas dos páginas, no cada carga del catálogo.
 */
async function legalTexto(req, res, next) {
  try {
    const tipo = req.query.tipo;
    if (!LEGAL_CLAVES[tipo]) {
      return res.status(400).json({ error: 'tipo debe ser "privacidad" o "terminos"' });
    }
    const empresaId = await resolverEmpresaUnica();
    if (!empresaId) return res.json({ titulo: LEGAL_TITULOS[tipo], texto: '' });
    const b = await branding.getBranding(empresaId);
    res.json({ titulo: LEGAL_TITULOS[tipo], texto: b.config[LEGAL_CLAVES[tipo]] || '' });
  } catch (err) { next(err); }
}

// Árbol familia → categoria_prod (solo ramas con al menos un producto
// publicado), para el sidebar expandible del catálogo. Un tercer nivel
// (subcategorias_prod) existe en el esquema pero no se usa aquí — el filtro
// de familia_id/categoria_id ya acota lo suficiente para navegación pública.
async function categorias(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT f.id AS familia_id, f.nombre AS familia_nombre,
              c.id AS categoria_id, c.nombre AS categoria_nombre
       FROM productos p
       JOIN familias f ON f.id = p.familia_id
       LEFT JOIN categorias_prod c ON c.id = p.categoria_id AND c.activo = 1
       WHERE p.activo = 1 AND p.publicar_web = 1
       ORDER BY f.nombre, c.nombre`
    );
    const porFamilia = new Map();
    for (const r of rows) {
      if (!porFamilia.has(r.familia_id)) {
        porFamilia.set(r.familia_id, { id: r.familia_id, nombre: r.familia_nombre, categorias: [] });
      }
      if (r.categoria_id) {
        porFamilia.get(r.familia_id).categorias.push({ id: r.categoria_id, nombre: r.categoria_nombre });
      }
    }
    res.json([...porFamilia.values()]);
  } catch (err) { next(err); }
}

// El buscador compara tanto la descripción como el nombre de familia/categoría/
// subcategoría (las tres tablas de taxonomía) — así "dolor" encuentra productos
// clasificados bajo subcategorías como "Dolor muscular" aunque la palabra no
// aparezca en su descripción. Requiere los LEFT JOIN a f/c/s (ver productosList).
function construirFiltro(query) {
  const where = ['p.activo = 1', 'p.publicar_web = 1'];
  const vals = [];
  if (query.q) {
    where.push('(p.descripcion LIKE ? OR p.descripcion_corta LIKE ? OR f.nombre LIKE ? OR c.nombre LIKE ? OR s.nombre LIKE ?)');
    vals.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.categoria_id) { where.push('p.categoria_id = ?'); vals.push(query.categoria_id); }
  else if (query.familia_id) { where.push('p.familia_id = ?'); vals.push(query.familia_id); }
  return { where, vals };
}

async function productosList(req, res, next) {
  try {
    const { where, vals } = construirFiltro(req.query);
    const limit = Math.min(parseInt(req.query.limit) || 24, 60);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    // DISTINCT: un producto no debe duplicarse si por alguna razón coincidiera
    // por más de una columna del JOIN (no pasa hoy, pero es más seguro).
    const [rows] = await pool.query(
      `SELECT DISTINCT p.id, p.descripcion, p.descripcion_corta, p.imagen_url, p.precio_lista,
              p.clasificacion_cofepris, p.fabricante, p.unidad_medida,
              f.nombre AS familia_nombre,
              COALESCE((SELECT SUM(l.cantidad_actual) FROM inventario_lotes l WHERE l.producto_id = p.id), 0) AS existencia
       FROM productos p
       LEFT JOIN familias f ON f.id = p.familia_id
       LEFT JOIN categorias_prod c ON c.id = p.categoria_id
       LEFT JOIN subcategorias_prod s ON s.id = p.subcategoria_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.descripcion
       LIMIT ? OFFSET ?`,
      [...vals, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(DISTINCT p.id) AS total
       FROM productos p
       LEFT JOIN familias f ON f.id = p.familia_id
       LEFT JOIN categorias_prod c ON c.id = p.categoria_id
       LEFT JOIN subcategorias_prod s ON s.id = p.subcategoria_id
       WHERE ${where.join(' AND ')}`, vals
    );
    const empresaId = await resolverEmpresaUnica();
    const conPrecio = await decorarPrecios(rows, empresaId);
    const decorados = conPrecio.map((r) => ({
      ...r,
      requiere_receta: !CLASIF_LIBRES.includes(r.clasificacion_cofepris),
      disponible: Number(r.existencia) > 0,
    }));
    res.json({ rows: decorados, total });
  } catch (err) { next(err); }
}

async function productoDetalle(req, res, next) {
  try {
    const [[row]] = await pool.query(
      `SELECT p.id, p.descripcion, p.descripcion_corta, p.imagen_url, p.precio_lista,
              p.clasificacion_cofepris, p.fabricante, p.unidad_medida, p.ean,
              p.sustancia_activa, p.tamano, p.calibre, p.especificacion,
              f.nombre AS familia_nombre, c.nombre AS categoria_nombre,
              COALESCE((SELECT SUM(l.cantidad_actual) FROM inventario_lotes l WHERE l.producto_id = p.id), 0) AS existencia
       FROM productos p
       LEFT JOIN familias f        ON f.id = p.familia_id
       LEFT JOIN categorias_prod c ON c.id = p.categoria_id
       WHERE p.id = ? AND p.activo = 1 AND p.publicar_web = 1`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Producto no encontrado' });
    const empresaId = await resolverEmpresaUnica();
    const [conPrecio] = await decorarPrecios([row], empresaId);
    res.json({
      ...conPrecio,
      requiere_receta: !CLASIF_LIBRES.includes(row.clasificacion_cofepris),
      disponible: Number(row.existencia) > 0,
    });
  } catch (err) { next(err); }
}

// GET /tienda/sitemap.xml — solo URLs públicas reales: home, productos
// publicados y las dos páginas legales (siempre existen, ver PaginaLegal.jsx).
// FRONTEND_URL es la misma variable que ya usa cors() en app.js — es el
// dominio público real de esta instancia, no el puerto interno de Node.
async function sitemap(req, res, next) {
  try {
    const base = process.env.FRONTEND_URL || 'http://localhost:5173';
    const [productos] = await pool.query(
      `SELECT id FROM productos WHERE activo = 1 AND publicar_web = 1`
    );
    const urls = [
      `${base}/tienda`,
      `${base}/tienda/privacidad`,
      `${base}/tienda/terminos`,
      ...productos.map((p) => `${base}/tienda/${p.id}`),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
      `\n</urlset>`;
    res.type('application/xml').send(xml);
  } catch (err) { next(err); }
}

const EMAIL_PATRON = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /tienda/suscriptores — captura de boletín, pública (mismo posture que
// el resto del módulo). ON DUPLICATE KEY UPDATE hace que re-suscribirse con
// el mismo correo no truene ni genere filas duplicadas (uq_empresa_email,
// migrate_v58.js).
async function suscribir(req, res, next) {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!EMAIL_PATRON.test(email)) {
      return res.status(400).json({ error: 'Correo inválido' });
    }
    const empresaId = await resolverEmpresaUnica();
    if (!empresaId) return res.status(503).json({ error: 'No disponible por el momento' });
    const nombre = (req.body.nombre || '').trim() || null;
    await pool.query(
      `INSERT INTO tienda_suscriptores (empresa_id, email, nombre)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE activo = 1, nombre = COALESCE(VALUES(nombre), nombre)`,
      [empresaId, email, nombre]
    );
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { info, legalTexto, categorias, productosList, productoDetalle, sitemap, suscribir };
