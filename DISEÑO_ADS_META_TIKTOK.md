# Diseño: integración directa con Meta Ads y TikTok Ads (sin software externo)

Estado: **IMPLEMENTADO** (2026-09-03) — pendiente solo de configurar credenciales en el servidor y capturar los Pixel ID en el admin. Falta correr `migrate_v71.js`.
Relacionado: `dismed/backend/src/modules/tienda/*`, `dismed/backend/src/services/branding.service.js`, `frontend/src/pages/Tienda/*`

## Estado de implementación (2026-09-03)

Todo lo de las secciones 1–4 quedó implementado; la sección 5 (opcional) también:

| Pieza | Archivos |
|---|---|
| Feed de catálogo `GET /tienda/feed/meta.csv` y `/tienda/feed/tiktok.csv` (token `FEED_TOKEN`, excluye receta + `productos.excluir_ads`) | `tienda.feed.controller.js`, ruta en `tienda.routes.js` |
| Config de env (tokens CAPI/Events, test codes, feed token) | `tienda.ads.config.js` (uno solo en vez de dos) |
| Pixel ID editable por el admin (grupo "Marketing") + expuesto en `GET /tienda/info` | `branding.service.js` (`meta_pixel_id`/`tiktok_pixel_id`), `tienda.controller.js#info`, `frontend/.../Configuracion/Empresas.jsx` |
| Conversions API (Meta) + Events API (TikTok), hash SHA-256, nunca lanza | `services/metaCapi.service.js`, `services/tiktokEventsApi.service.js`, orquestador `services/adsEventos.service.js` |
| Evento `Purchase`/`CompletePayment` en el webhook de Stripe | `tienda.checkout.service.js#confirmarPago` |
| Evento en la confirmación de pedido por WhatsApp + captura de `ctwa_clid` | `whatsapp.carrito.service.js#confirmarPedidoFinal`, `whatsapp.service.js#procesarMensajeEntrante` |
| Pixel de navegador (fbq/ttq) + `ViewContent`/`AddToCart`/`InitiateCheckout`/`Contact` | `frontend/src/utils/tiendaPixel.js`, `frontend/src/hooks/useTiendaPixel.js`, wired en `Catalogo.jsx`/`DetalleProducto.jsx`/`Carrito.jsx` |
| `productos.excluir_ads`, `whatsapp_contactos.ctwa_clid`, tabla `tienda_eventos_ads` (bitácora) | `migrate_v71.js` |

**Pasos para activarlo:**
1. `python deploy.py --migrar migrate_v71.js`
2. En el servidor (`.env`): `FEED_TOKEN` (aleatorio largo), `META_CAPI_ACCESS_TOKEN`, `TIKTOK_EVENTS_ACCESS_TOKEN` (y opcionalmente los `*_TEST_EVENT_CODE` mientras se prueba).
3. En el admin → Configuración → Empresas → Marketing: capturar `Meta Pixel ID` y `TikTok Pixel ID`.
4. En Meta/TikTok Events Manager: dar de alta el feed apuntando a `https://<dominio>/api/tienda/feed/meta.csv?token=<FEED_TOKEN>` (y el de tiktok).

**Desviación del diseño:** se usó un solo archivo de config (`tienda.ads.config.js`) en vez de `tienda.meta.config.js` + `tienda.tiktok.config.js` — el contrato es idéntico y el bloque de `.env` queda junto.

## Contexto

Objetivo: que farmacia.innovacom.mx pueda anunciarse en Meta (Facebook/Instagram) y TikTok con Catálogo de productos dinámico + medición de conversiones, sin depender de un plugin de terceros (Channable, Feedonomics, etc.) ni de una plataforma de e-commerce distinta — todo vive dentro del módulo `tienda` ya existente.

Revisé el código real (no supuestos): el sitio corre sobre Dismed (Node/Express + React/Vite), módulo `tienda`, multi-tenant por `empresaId`. Hoy no existe ningún Pixel, Conversions API, ni feed de catálogo (confirmado por grep en `backend/src` y `frontend/src`). Sí existen piezas reutilizables clave:

- `productos.clasificacion_cofepris` + la constante `CLASIF_LIBRES` ya calculan `requiere_receta` en `tienda.controller.js` (`productosList`, `productoDetalle`). **El filtro "no anunciar medicamentos con receta" ya está resuelto por el sistema** — el feed solo tiene que reusar esa misma condición.
- `productos.ean` existe (GTIN) — mejora la calidad del feed en ambas plataformas.
- `sucursales` ya guarda `latitud`/`longitud`, `responsable_sanitario`, `cedula_responsable_sanitario`, `licencia_sanitaria` — es exactamente la prueba de autorización regulatoria que Meta/TikTok piden, y las coordenadas para segmentar por radio.
- `branding.service.js` ya tiene un patrón de configuración editable desde el admin (`tienda_facebook`, `tienda_instagram`, etc.) — ahí se agregan los IDs de Pixel (públicos, no secretos).
- `tienda.stripe.config.js` ya define el patrón para credenciales opcionales por variable de entorno (`get()` / `estaConfigurado()` / cliente perezoso) — se replica igual para Meta CAPI y TikTok Events API.
- Ya existe checkout con Stripe (`tienda.checkout.controller.js` + webhook) — es el mejor punto para el evento de compra confirmada sin depender del navegador del cliente.
- El flujo de venta real hoy es WhatsApp (`whatsapp.carrito.service.js`, `whatsapp.pedidos.service.js`), no Stripe — cualquier plan que solo instrumente el checkout de Stripe va a subcontar la mayoría de las ventas reales.

## Qué hay que construir

### 1. Feed de catálogo de productos (backend, nuevo)

Archivo nuevo: `dismed/backend/src/modules/tienda/tienda.feed.controller.js`, registrado en `tienda.routes.js` junto a las rutas públicas existentes.

- `GET /tienda/feed/meta.csv?token=...`
- `GET /tienda/feed/tiktok.csv?token=...`

Misma query base que `productosList` (sin paginar), agregando:

```sql
WHERE p.activo = 1 AND p.publicar_web = 1
  AND p.clasificacion_cofepris IN (/* CLASIF_LIBRES */)   -- excluye receta automáticamente
```

Columnas del feed (estándar compartido por Meta y TikTok): `id, title, description, availability, condition=new, price, link, image_link, brand, gtin`.
Mapeo: `id→p.id`, `title→p.descripcion`, `description→p.descripcion_corta`, `availability→disponible ? "in stock" : "out of stock"`, `price→` precio_lista con precio final (misma función `decorarPrecios` que ya usa el catálogo) + " MXN", `link→` `${FRONTEND_URL}/tienda/{id}`, `image_link→` `imagen_url` absoluta, `brand→p.fabricante`, `gtin→p.ean` (solo si no vacío).

Protección: el feed es público por naturaleza (Meta/TikTok lo descargan por URL programada, sin OAuth), pero se protege con un token compartido en la query string (`FEED_TOKEN` en `.env.server`) para que no cualquiera pueda raspar la lista de precios — mismo nivel de exposición que ya acepta el resto de `/tienda` público, solo que no indexable.

Un solo generador de filas compartido entre los dos controladores (evita mantener dos queries).

### 2. Config de Pixel/API — nuevos archivos, mismo patrón que Stripe

- `dismed/backend/src/modules/tienda/tienda.meta.config.js` — lee `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_CAPI_TEST_EVENT_CODE` (opcional, para probar en el Test Events tool antes de lanzar), `FEED_TOKEN`.
- `dismed/backend/src/modules/tienda/tienda.tiktok.config.js` — `TIKTOK_PIXEL_ID`, `TIKTOK_EVENTS_ACCESS_TOKEN`.
- Agregar bloque nuevo a `.env.server` (plantilla) documentando estas variables, igual que el bloque de Stripe.
- Agregar `meta_pixel_id` y `tiktok_pixel_id` (IDs, no son secretos) como claves nuevas en `branding.service.js` — grupo `tienda` o un grupo nuevo `marketing` — así Rodrigo los captura desde el admin sin tocar código ni redeploy. Los tokens de acceso (CAPI/Events API) NUNCA van en `branding` (son secretos): solo en `.env.server`, igual que `STRIPE_SECRET_KEY`.
- `GET /tienda/info` ya es el bootstrap que carga el frontend — se le agregan `meta_pixel_id`/`tiktok_pixel_id` al `res.json(...)` existente (mismo lugar que ya expone `pago_habilitado`).

### 3. Server-side: Conversions API (Meta) + Events API (TikTok)

Nuevos servicios: `dismed/backend/src/services/metaCapi.service.js` y `dismed/backend/src/services/tiktokEventsApi.service.js`. Cada uno expone una función `enviarEvento({ eventName, userData, customData, eventSourceUrl })` que hace el POST firmado (hash SHA-256 de email/teléfono antes de enviarlo, como exige Meta).

Puntos donde se dispara el evento de "compra" (`Purchase` en Meta, `CompletePayment` en TikTok):

1. **Webhook de Stripe** (`checkout.session.completed`, dentro de `tienda.checkout.controller.js`) — dispara el evento solo cuando el pago ya se confirmó, nunca al solo "iniciar" el checkout.
2. **Confirmación de pedido por WhatsApp** (`whatsapp.carrito.service.js` / `whatsapp.pedidos.service.js`) — este es el canal de venta real hoy, así que sin este segundo punto las campañas nunca van a mostrar ventas aunque sí las haya. Envolver en try/catch que jamás bloquee el flujo de pedido si la llamada a Meta/TikTok falla.

Para que el clic a WhatsApp se pueda atribuir de vuelta a la campaña: capturar el parámetro `ctwa_clid` (Meta) que llega en la URL cuando alguien entra a WhatsApp desde un anuncio de clic-a-WhatsApp, y guardarlo junto con el pedido para incluirlo en el evento de compra server-side.

### 4. Frontend: Pixel + eventos de navegador

En el layout raíz de `/tienda` (después de que resuelve `GET /tienda/info`): si viene `meta_pixel_id`, inyecta el snippet estándar de `fbq('init', ...)` + `PageView`; igual para `ttq.load()/page()` con `tiktok_pixel_id`. Solo se cargan los scripts si el ID está configurado (mismo criterio que ya oculta el carrito cuando Stripe no está configurado).

Eventos a instrumentar:
- `ViewContent` al entrar a la ficha de producto.
- `AddToCart` al agregar al carrito.
- `InitiateCheckout` al iniciar el pago con Stripe.
- `Contact` al hacer clic en "Pedir por WhatsApp" — importante porque hoy es la conversión real, no el checkout.

### 5. Opcional / no bloqueante para v1

- Migración chica: `productos.excluir_ads BOOLEAN DEFAULT 0` si Rodrigo quiere excluir un producto OTC específico del feed sin quitarlo de la tienda.
- Tabla `tienda_eventos_ads` (log de cada evento enviado a Meta/TikTok, con éxito/error) para depurar sin adivinar por qué una campaña no muestra conversiones.

## Orden recomendado de implementación

1. Feed de catálogo + claves de branding (sin riesgo, no toca checkout ni WhatsApp).
2. Pixel de navegador + eventos ViewContent/AddToCart/Contact (bajo riesgo, visible rápido).
3. Conversions API / Events API en el webhook de Stripe (aislado, no toca el flujo de WhatsApp).
4. Conversions API / Events API en la confirmación de pedidos de WhatsApp + captura de `ctwa_clid` (el más valioso, pero toca el código que más se usa — va al final y con try/catch defensivo).

## Referencias
- Meta Conversions API: https://developers.facebook.com/docs/marketing-api/conversions-api
- Meta Catalog feed spec: https://www.facebook.com/business/help/120325381656392
- TikTok Events API: https://business-api.tiktok.com/portal/docs?id=1771100965992450
- TikTok Catalog feed spec: mismo formato base que Google Merchant Center / Meta
