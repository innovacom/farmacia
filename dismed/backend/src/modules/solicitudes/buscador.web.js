const { buscarConWeb } = require('../../config/ai.provider');

/**
 * Busca en internet el precio de una partida usando búsqueda web con grounding
 * (Google Search en Gemini, o el tool server-side web_search en Anthropic).
 *
 * Flujo en dos pasos dentro de la misma conversación:
 *  1. Identificar el producto (búsqueda libre en cualquier página del mundo):
 *     referencia del fabricante, descripción genérica, clave de cuadro básico IMSS.
 *  2. Obtener precios SOLO de tiendas que entregan en la República Mexicana.
 *
 * Retorna: { identificacion: {...}, ofertas: [{tienda, url, precio_mxn, notas}] }
 */
async function buscarPrecioWeb(partida) {
  const prompt = `Eres un asistente de compras de una distribuidora de insumos médicos en México.

PRODUCTO SOLICITADO:
- Descripción: ${partida.descripcion_original}
- Código del cliente: ${partida.codigo_cliente || '(no disponible)'}
- Clave de gobierno / cuadro básico: ${partida.codigo_gobierno || '(no disponible)'}
- Cantidad solicitada: ${partida.cantidad} ${partida.unidad_medida}

TU OBJETIVO PRINCIPAL es encontrar PRECIOS del producto en tiendas en línea que entreguen en la República Mexicana. La identificación es solo un medio para lograrlo.

TAREA:
1. IDENTIFICAR el producto (máximo 1-2 búsquedas). Busca en internet (páginas de cualquier país) para determinar qué producto es: código o referencia del fabricante, descripción común/genérica y clave de cuadro básico del IMSS si aplica. Si la descripción ya es clara (producto genérico común), salta directo al paso 2.
2. OBTENER PRECIOS (dedica aquí la mayoría de las búsquedas). Busca en español el precio del producto en tiendas en línea mexicanas. Haz varias búsquedas distintas combinando: la descripción genérica + "precio" o "comprar", la referencia del fabricante, y la clave de cuadro básico. Tiendas útiles: www.medifacil.com, heka.mx, degasa, dentalist, Mercado Libre México (mercadolibre.com.mx), y cualquier tienda mexicana de insumos médicos.

REGLAS:
- La restricción de "solo México" aplica EXCLUSIVAMENTE a los precios; la identificación puede hacerse en cualquier página del mundo.
- Devuelve hasta 3 ofertas de tiendas distintas, priorizando precio bajo. UNA SOLA oferta también es valioso: es mejor devolver 1 oferta que 0.
- Mercado Libre México ES aceptable como fuente de precio.
- Cada oferta debe incluir la URL exacta de la página del producto donde aparece el precio.
- El precio debe ser UNITARIO en MXN. Si la página vende caja/paquete, divide entre el contenido y explícalo en "notas".
- Devuelve "ofertas": [] solo si después de varias búsquedas realmente no existe ningún precio publicado en México.

Responde ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "identificacion": {
    "producto": "descripción genérica identificada",
    "referencia_fabricante": "código o referencia del fabricante, o cadena vacía",
    "clave_cuadro_basico": "clave de cuadro básico IMSS, o cadena vacía",
    "confianza": "alta|media|baja"
  },
  "ofertas": [
    { "tienda": "nombre de la tienda", "url": "https://...", "precio_mxn": 123.45, "notas": "aclaraciones (presentación, IVA, etc.)" }
  ]
}`;

  const { text: texto, tokens } = await buscarConWeb({ prompt, maxTokens: 4000 });

  const jsonMatch = (texto || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('La IA no devolvió un resultado válido para esta partida.');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const ofertas = (Array.isArray(parsed.ofertas) ? parsed.ofertas : [])
    .map((o) => ({
      tienda:     String(o.tienda || '').trim(),
      url:        String(o.url || '').trim(),
      precio_mxn: parseFloat(o.precio_mxn) || 0,
      notas:      String(o.notas || '').trim(),
    }))
    .filter((o) => o.tienda && /^https?:\/\//i.test(o.url) && o.precio_mxn > 0);

  return {
    identificacion: {
      producto:              String(parsed.identificacion?.producto || '').trim(),
      referencia_fabricante: String(parsed.identificacion?.referencia_fabricante || '').trim(),
      clave_cuadro_basico:   String(parsed.identificacion?.clave_cuadro_basico || '').trim(),
      confianza:             String(parsed.identificacion?.confianza || 'media').trim(),
    },
    ofertas,
    tokens_usados: tokens,
  };
}

module.exports = { buscarPrecioWeb };
