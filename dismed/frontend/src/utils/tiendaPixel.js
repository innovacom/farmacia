// tiendaPixel.js — Pixel de Meta (fbq) y TikTok (ttq) para el catálogo
// público /tienda. Los scripts SOLO se cargan si el ID correspondiente viene
// en GET /tienda/info (meta_pixel_id / tiktok_pixel_id, capturados por el
// admin en Configuración → Empresas → Marketing) — igual que el carrito solo
// aparece si Stripe está configurado. Ver DISEÑO_ADS_META_TIKTOK.md.
//
// Todo es defensivo: si un script no cargó (bloqueador, red), las funciones
// de track no hacen nada en vez de tronar la página.

let iniciado = false;

function cargarMetaPixel(pixelId) {
  if (window.fbq) return;
  /* eslint-disable */
  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', pixelId);
  window.fbq('track', 'PageView');
}

function cargarTikTokPixel(pixelId) {
  if (window.ttq) return;
  /* eslint-disable */
  !(function (w, d, t) {
    w.TiktokAnalyticsObject = t;
    var ttq = (w[t] = w[t] || []);
    ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
    ttq.setAndDefer = function (e, n) {
      e[n] = function () { e.push([n].concat(Array.prototype.slice.call(arguments, 0))); };
    };
    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (e) {
      var n = ttq._i[e] || [];
      for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(n, ttq.methods[i]);
      return n;
    };
    ttq.load = function (e, n) {
      var r = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      var o = n && n.partner;
      ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = r;
      ttq._t = ttq._t || {}; ttq._t[e] = +new Date();
      ttq._o = ttq._o || {}; ttq._o[e] = n || {};
      n = d.createElement('script'); n.type = 'text/javascript'; n.async = !0; n.src = r + '?sdkid=' + e + '&lib=' + t;
      e = d.getElementsByTagName('script')[0]; e.parentNode.insertBefore(n, e);
    };
    ttq.load(pixelId);
    ttq.page();
  })(window, document, 'ttq');
  /* eslint-enable */
}

// Llamar una sola vez, cuando GET /tienda/info ya resolvió.
export function initTiendaPixel(info) {
  if (iniciado || !info) return;
  iniciado = true;
  try { if (info.meta_pixel_id) cargarMetaPixel(String(info.meta_pixel_id)); } catch (e) { /* noop */ }
  try { if (info.tiktok_pixel_id) cargarTikTokPixel(String(info.tiktok_pixel_id)); } catch (e) { /* noop */ }
}

function fbqTrack(evento, params) {
  try { if (window.fbq) window.fbq('track', evento, params); } catch (e) { /* noop */ }
}
function ttqTrack(evento, params) {
  try { if (window.ttq && window.ttq.track) window.ttq.track(evento, params); } catch (e) { /* noop */ }
}

// ── Eventos ────────────────────────────────────────────────────────────────
// Nombres estándar: Meta y TikTok comparten casi todos salvo el de "compra"
// (Purchase / CompletePayment), que aquí no se dispara desde el navegador —
// va server-side (adsEventos.service.js) para no subcontar las ventas por
// WhatsApp ni depender de que el navegador vuelva del checkout de Stripe.

// content_id = productos.id, el mismo que usa la columna "id" del feed
// (tienda.feed.controller.js) — es la clave que Meta/TikTok usan para
// casar un evento del pixel con un renglón del catálogo. Sin content_type +
// price + content_id consistentes en cada evento, el catálogo no "empareja"
// eventos con productos y el anuncio dinámico (Dynamic Showcase / Advantage+
// Catalog) no puede armarse aunque el feed ya esté cargado.
function ttqContent({ id, nombre, valor, cantidad }) {
  if (id == null) return undefined;
  return [{
    content_id: String(id),
    content_type: 'product',
    content_name: nombre,
    price: valor != null ? Number(valor) : undefined,
    quantity: cantidad || 1,
  }];
}

// InitiateCheckout y AddPaymentInfo van sobre el carrito completo (varios
// productos, no uno) — TikTok exige content_id en TODOS sus eventos, no solo
// en ViewContent/AddToCart ("Content ID is missing"), así que aquí se arma
// un content_id por cada línea del carrito en vez de mandar el evento vacío.
// items: [{ producto_id, descripcion, precio_final, cantidad }] (forma de
// tiendaCarritoStore.js).
function contentsDeCarrito(items) {
  if (!items || !items.length) return undefined;
  return items.map((it) => ({
    content_id: String(it.producto_id),
    content_type: 'product',
    content_name: it.descripcion,
    price: it.precio_final != null ? Number(it.precio_final) : undefined,
    quantity: it.cantidad || 1,
  }));
}
function contentIdsDeCarrito(items) {
  return items && items.length ? items.map((it) => String(it.producto_id)) : undefined;
}

export function trackViewContent({ id, nombre, valor } = {}) {
  fbqTrack('ViewContent', { content_ids: id != null ? [String(id)] : undefined, content_name: nombre, content_type: 'product', currency: 'MXN', value: valor });
  ttqTrack('ViewContent', { contents: ttqContent({ id, nombre, valor }), content_type: 'product', currency: 'MXN', value: valor });
}

export function trackAddToCart({ id, nombre, valor, cantidad } = {}) {
  fbqTrack('AddToCart', { content_ids: id != null ? [String(id)] : undefined, content_name: nombre, content_type: 'product', currency: 'MXN', value: valor });
  ttqTrack('AddToCart', { contents: ttqContent({ id, nombre, valor, cantidad }), content_type: 'product', currency: 'MXN', value: valor });
}

export function trackInitiateCheckout({ valor, numItems, items } = {}) {
  fbqTrack('InitiateCheckout', { currency: 'MXN', value: valor, num_items: numItems, content_ids: contentIdsDeCarrito(items) });
  ttqTrack('InitiateCheckout', { currency: 'MXN', value: valor, content_type: 'product', contents: contentsDeCarrito(items) });
}

// Paso previo a entrar a Stripe Checkout (no vemos datos de tarjeta, pero es
// el punto equivalente a "el cliente va a pagar") — evento estándar que
// TikTok pide para el embudo completo de catálogo (Video Shopping / Catalog
// Listing Ads), junto con ViewContent, AddToCart e InitiateCheckout.
export function trackAddPaymentInfo({ valor, numItems, items } = {}) {
  fbqTrack('AddPaymentInfo', { currency: 'MXN', value: valor, num_items: numItems, content_ids: contentIdsDeCarrito(items) });
  ttqTrack('AddPaymentInfo', { currency: 'MXN', value: valor, content_type: 'product', contents: contentsDeCarrito(items) });
}

// Búsqueda en el catálogo — alimenta remarketing dinámico ("la gente que
// buscó X") además de completar la lista de eventos estándar que TikTok
// sugiere para catálogo. Se dispara con la búsqueda ya "debounced" (no en
// cada tecla) para no inflar el conteo de eventos.
export function trackSearch(query) {
  const q = (query || '').trim();
  if (!q) return;
  fbqTrack('Search', { search_string: q });
  ttqTrack('Search', { query: q });
}

// Clic en "Pedir por WhatsApp" — hoy la conversión real, no el checkout.
export function trackContact() {
  fbqTrack('Contact');
  ttqTrack('Contact');
}
