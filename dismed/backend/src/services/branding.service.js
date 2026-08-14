/**
 * branding.service.js — Branding y parámetros por empresa (white-label POS).
 * Une `empresas` (logo, colores, tema, datos fiscales) + `empresas_config`
 * (clave-valor) con defaults. Caché en memoria con invalidación al editar
 * (mismo patrón que config/precios.js: la BD es la verdad, la copia en
 * memoria evita un query por request).
 *
 * Sin configurar nada, la empresa se ve como DISMED/INNOVACOM hoy
 * (colores actuales de tailwind.config.js y logo del Sidebar).
 */
const { pool } = require('../config/db');

// Default de tienda_aviso_privacidad: texto REAL, copiado íntegro del aviso
// de privacidad ya publicado en innovacom.mx/blank (misma razón social que
// la empresa id=1 de este sistema — no es una plantilla genérica). Si se
// onboarda un tenant con otra razón social, debe editarse desde
// Configuración → Empresas antes de publicar su /tienda.
const AVISO_PRIVACIDAD_DEFAULT = `AVISO DE PRIVACIDAD INTEGRAL

Rodricabr Innovación y Comercio S.A.S. de C.V. (en adelante, "EL RESPONSABLE"), con domicilio en Refinería Azcapotzalco 49, Colonia Petrolera Taxqueña, Coyoacán, Ciudad de México, C.P. 04200, y RFC RIC1903041Q2, reconoce la importancia del tratamiento legítimo, controlado e informado de sus datos personales. El presente Aviso de Privacidad se pone a su disposición para que conozca las prácticas de EL RESPONSABLE al obtener, usar, divulgar o almacenar sus datos.

1. DATOS PERSONALES QUE SE RECABAN

Para cumplir con las finalidades descritas en este aviso, recabaremos las siguientes categorías de datos personales a través de nuestro sitio web, formularios publicitarios en Meta Ads (Facebook e Instagram) y chats directos de WhatsApp:

Datos de Identificación: Nombre completo y RFC (para facturación).

Datos de Contacto: Domicilio de entrega, correo electrónico y número telefónico (móvil/WhatsApp).

Datos de Navegación: Dirección IP, tipo de navegador y comportamiento en el sitio a través de Cookies y herramientas de optimización publicitaria (Píxel de Meta).

Nota sobre Datos Financieros: EL RESPONSABLE no recaba ni almacena datos de tarjetas bancarias. Los pagos son procesados directamente por terceros autorizados (PayPal y Mercado Pago), quienes cuentan con sus propias políticas de seguridad y privacidad.

2. FINALIDADES DEL TRATAMIENTO

Finalidades Primarias (necesarias para el servicio): gestionar su registro como usuario en nuestra tienda en línea; procesar sus pedidos, gestionar el envío de mercancía y aplicar la política de garantía de 30 días y reembolsos; contactarle de manera directa vía WhatsApp, llamadas telefónicas o correo electrónico para atender solicitudes de información, cotizaciones, soporte o dudas generadas en nuestras campañas publicitarias; emitir los comprobantes fiscales (facturas) solicitados; brindar soporte técnico y atención al cliente.

Finalidades Secundarias (adicionales): envío de publicidad, ofertas personalizadas, boletines informativos y promociones de nuestros productos a través de correo electrónico o mensajería automatizada/masiva por WhatsApp. Si usted no desea que sus datos sean utilizados para estas finalidades secundarias, puede enviar un correo en cualquier momento a legal@innovacom.mx manifestando su negativa o responder con la palabra "BAJA" en cualquiera de nuestros chats.

3. TRANSFERENCIA DE DATOS PERSONALES Y PROCESAMIENTO POR TERCEROS

EL RESPONSABLE únicamente transferirá o procesará sus datos personales en los siguientes supuestos: Empresas de Logística y Mensajería, para realizar la entrega física de sus productos; Meta Platforms, Inc. (Facebook, Instagram, WhatsApp), para la gestión técnica de las comunicaciones por chat y la recepción de datos de clientes potenciales derivados de anuncios (Meta procesa esta información de forma segura bajo sus propios estándares globales de privacidad); Autoridades, para dar cumplimiento a obligaciones legales o fiscales. No compartimos, vendemos ni transferimos sus datos a terceros con fines de marketing o socios comerciales ajenos a la operación de la empresa.

4. USO DE COOKIES, PÍXELES Y TECNOLOGÍAS DE RASTREO

Nuestro sitio web utiliza cookies, Píxel de Meta y otras tecnologías para monitorear su comportamiento como usuario. Esto nos permite brindarle una mejor experiencia de navegación y optimizar la relevancia de los anuncios que le mostramos en redes sociales. Estos datos incluyen su tipo de navegador, sistema operativo y páginas visitadas. Usted puede deshabilitar el uso de estas tecnologías a través de la configuración de su navegador de internet o de sus preferencias de anuncios en Meta.

5. DERECHOS ARCO Y REVOCACIÓN DEL CONSENTIMIENTO

Usted tiene derecho a Acceder, Rectificar, Cancelar u Oponerse (Derechos ARCO) al tratamiento de sus datos personales, así como a revocar su consentimiento. Deberá enviar una solicitud al correo electrónico legal@innovacom.mx, incluyendo nombre del titular, documento que acredite su identidad y una descripción clara del derecho que desea ejercer. Recibirá una respuesta en un plazo máximo de 20 días hábiles.

6. SEGURIDAD DE LOS DATOS

EL RESPONSABLE implementa medidas de seguridad administrativas, técnicas y físicas para proteger sus datos personales contra daño, pérdida, alteración o uso no autorizado.

7. CAMBIOS AL AVISO DE PRIVACIDAD

Nos reservamos el derecho de efectuar en cualquier momento modificaciones o actualizaciones al presente aviso para la atención de novedades legislativas o políticas internas, especialmente aquellas requeridas por las plataformas de Meta. Estas modificaciones estarán disponibles al público en esta sección de nuestro sitio web.`;

// Default de tienda_terminos: a diferencia del aviso de privacidad, NO hay un
// equivalente real publicado hoy — esta sí es una plantilla genérica de
// términos de compra por WhatsApp. El admin debe revisarla/personalizarla
// antes de publicarla (ver nota en Configuración → Empresas).
const TERMINOS_DEFAULT = `TÉRMINOS Y CONDICIONES DE COMPRA

Al realizar un pedido a través de este catálogo o por WhatsApp, usted acepta los siguientes términos.

1. NATURALEZA DEL SERVICIO

Este catálogo es informativo. La compra se confirma directamente por WhatsApp con nuestro personal, quien le indicará disponibilidad, precio final y forma de entrega antes de procesar el pago.

2. PRECIOS Y DISPONIBILIDAD

Los precios mostrados pueden cambiar sin previo aviso y no son una oferta vinculante hasta que se confirme el pedido por WhatsApp. La disponibilidad de existencia se confirma al momento del pedido.

3. PROCESO DE COMPRA

El pedido se considera aceptado hasta que nuestro personal lo confirme por WhatsApp con el detalle final: productos, cantidades, precio total y forma de entrega.

4. ENTREGA

Los tiempos y zonas de entrega se indican al confirmar el pedido. Consulte la sección "Envíos" de esta página para más detalle.

5. CAMBIOS Y DEVOLUCIONES

Los cambios o devoluciones de producto se atienden caso por caso, contactando directamente por WhatsApp dentro de los primeros días posteriores a la entrega. Por su naturaleza, algunos productos de salud no son sujetos a devolución una vez entregados.

6. MEDICAMENTOS Y PRODUCTOS QUE REQUIEREN RECETA

Los productos marcados como "Requiere receta médica" solo se surten mediante la presentación de receta válida, conforme a la normativa sanitaria aplicable.

7. MEDIOS DE PAGO

Los medios de pago aceptados se indican en la sección "Formas de pago" de esta página, o se confirman directamente por WhatsApp al momento del pedido.

8. MODIFICACIONES

Nos reservamos el derecho de modificar estos términos en cualquier momento; los cambios aplican a partir de su publicación en esta página.`;

// Catálogo de claves válidas de empresas_config (patrón META de configuracion.controller.js).
// `grupo` sólo gobierna en qué sección del editor de empresa se dibuja la
// clave (Configuración → Empresas): 'pos' = parámetros del mostrador,
// 'tienda' = catálogo público. `patron` valida el formato cuando no hay
// lista cerrada de `valores` (URLs, correo) — sin él cualquier texto pasa,
// y estas claves terminan como href en una página pública.
const CONFIG_META = {
  ticket_ancho_mm:                { grupo: 'pos', label: 'Ancho del ticket (mm)', valores: ['58', '80'], default: '80' },
  ticket_leyenda_pie:             { grupo: 'pos', label: 'Leyenda al pie del ticket', maxLen: 300, default: '¡Gracias por su compra!' },
  ticket_mostrar_leyenda_factura: { grupo: 'pos', label: 'Mostrar leyenda de facturación en el ticket', valores: ['0', '1'], default: '1' },
  global_periodicidad_default:    { grupo: 'pos', label: 'Periodicidad default de factura global', valores: ['01', '04'], default: '01' },
  pos_permitir_descuento:         { grupo: 'pos', label: 'Permitir descuentos en mostrador', valores: ['0', '1'], default: '0' },

  // Grupo 'tienda' — encabezado y pie del catálogo público /tienda
  // (tienda.controller.js#info). Los patron de URL exigen "https:" y no
  // "https?:" a propósito: el valor termina como href en una página sin
  // login, y el regex es lo que impide que llegue un "javascript:"/"data:".
  tienda_lema:      { grupo: 'tienda', label: 'Lema (texto sobre el nombre en la tienda)', maxLen: 60, default: 'Farmacia de confianza' },
  tienda_subtitulo: { grupo: 'tienda', label: 'Subtítulo de la portada de la tienda', maxLen: 120, default: 'Pide en línea, recibe por WhatsApp el mismo día.' },
  tienda_email:     { grupo: 'tienda', label: 'Correo de contacto público', maxLen: 120, default: '',
                      patron: /^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, ayuda: 'contacto@mifarmacia.mx' },
  tienda_facebook:  { grupo: 'tienda', label: 'Facebook (URL completa)', maxLen: 200, default: '',
                      patron: /^$|^https:\/\/[\w.-]+\.[a-z]{2,}\/\S*$/i, ayuda: 'https://facebook.com/mifarmacia' },
  tienda_instagram: { grupo: 'tienda', label: 'Instagram (URL completa)', maxLen: 200, default: '',
                      patron: /^$|^https:\/\/[\w.-]+\.[a-z]{2,}\/\S*$/i, ayuda: 'https://instagram.com/mifarmacia' },
  // Fase 4 (checkout con Stripe, tienda.checkout.service.js): tarifa fija de
  // envío a domicilio — no hay cálculo por zona/distancia, es un solo monto
  // que el admin decide. Se valida numérico (hasta 2 decimales) porque este
  // valor se multiplica x100 y se manda tal cual a Stripe como shipping_rate.
  tienda_envio_domicilio_costo: { grupo: 'tienda', label: 'Costo fijo de envío a domicilio (MXN)', maxLen: 10, default: '0',
                      patron: /^\d{1,6}(\.\d{1,2})?$/, ayuda: '80.00' },

  // Grupo 'legal' — Fase 2 del pie de /tienda (tienda.controller.js#legalTexto
  // para privacidad/terminos, #info para envíos/pago/leyenda). `multilinea`
  // le dice al editor de empresa (Configuración → Empresas) que pinte
  // <textarea> en vez de <input> — sin esa marca, el admin no podría
  // capturar más de una línea de texto.
  tienda_aviso_privacidad:     { grupo: 'legal', label: 'Aviso de privacidad', multilinea: true, maxLen: 6000, default: AVISO_PRIVACIDAD_DEFAULT },
  tienda_terminos:             { grupo: 'legal', label: 'Términos y condiciones', multilinea: true, maxLen: 6000, default: TERMINOS_DEFAULT },
  tienda_politica_envios:      { grupo: 'legal', label: 'Política de envíos', multilinea: true, maxLen: 800, default: '' },
  tienda_formas_pago:          { grupo: 'legal', label: 'Formas de pago aceptadas', multilinea: true, maxLen: 400, default: '' },
  tienda_leyenda_medicamentos: { grupo: 'legal', label: 'Leyenda de venta de medicamentos', multilinea: true, maxLen: 400, default: '' },
};

// Colores actuales de la paleta brand (tailwind.config.js) — fallback white-label
const DEFAULTS = {
  color_primario: '#1a6bb5',
  color_secundario: null,
  tema: 'claro',
};

const cache = new Map(); // empresaId -> branding

async function getBranding(empresaId) {
  if (cache.has(empresaId)) return cache.get(empresaId);

  const [[empresa]] = await pool.query('SELECT * FROM empresas WHERE id = ?', [empresaId]);
  if (!empresa) {
    const err = new Error('Empresa no encontrada'); err.status = 404; throw err;
  }
  const [cfgRows] = await pool.query(
    'SELECT clave, valor FROM empresas_config WHERE empresa_id = ?', [empresaId]
  );
  const config = {};
  for (const clave of Object.keys(CONFIG_META)) config[clave] = CONFIG_META[clave].default;
  for (const row of cfgRows) if (row.clave in CONFIG_META) config[row.clave] = row.valor;

  const branding = {
    empresa_id: empresa.id,
    nombre: empresa.nombre,
    nombre_comercial: empresa.nombre_comercial || empresa.nombre,
    rfc: empresa.rfc,
    regimen_fiscal: empresa.regimen_fiscal,
    codigo_postal: empresa.codigo_postal,
    logo_url: empresa.logo_path ? `/uploads/branding/${empresa.logo_path}` : null,
    logo_ticket_url: empresa.logo_ticket_path
      ? `/uploads/branding/${empresa.logo_ticket_path}`
      : (empresa.logo_path ? `/uploads/branding/${empresa.logo_path}` : null),
    color_primario: empresa.color_primario || DEFAULTS.color_primario,
    color_secundario: empresa.color_secundario || DEFAULTS.color_secundario,
    tema: empresa.tema || DEFAULTS.tema,
    config,
  };
  cache.set(empresaId, branding);
  return branding;
}

function invalidar(empresaId) {
  if (empresaId) cache.delete(Number(empresaId));
  else cache.clear();
}

module.exports = { getBranding, invalidar, CONFIG_META };
