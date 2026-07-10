const fs = require('fs');
const pdfParse = require('pdf-parse');
const { extraerJSON } = require('../../config/ai.provider');

// Mismo patrón que solicitudes/parser.pdf.js: se extrae el texto del PDF con pdf-parse
// y se manda ese texto (no el binario) a la IA. Si el PDF es un escaneo sin capa de texto,
// pdf-parse no devuelve nada útil y se lanza error -> el llamador lo manda a revisión manual.
const INSTRUCCIONES_EXTRACTOR = `Eres un asistente especializado en facturas (CFDI) de proveedores de insumos médicos en México.

El XML del CFDI NO incluye lote ni fecha de caducidad por partida (son datos logísticos, no fiscales),
pero casi siempre SÍ aparecen impresos en la representación en PDF de la factura. Tu tarea es extraer
el encabezado fiscal básico (para vincular con el CFDI ya conocido) y, partida por partida, el número
de lote y la fecha de caducidad si están impresos.

La representación en PDF de un CFDI casi siempre muestra DOS RFC: el del EMISOR (quien vende/factura,
normalmente arriba, junto al nombre/razón social del proveedor) y el del RECEPTOR (quien compra, nosotros).
Extrae SIEMPRE el del EMISOR — NUNCA el del receptor, aunque el del receptor aparezca primero o más
destacado en el diseño del PDF.

Extrae:
- rfc_emisor: RFC del proveedor que EMITE/VENDE (nunca el nuestro como receptor/comprador)
- folio: folio o número de factura (serie+folio si aplica)
- uuid: folio fiscal (UUID) si aparece impreso, si no vacío ""
- fecha: fecha de emisión (YYYY-MM-DD)
- total: importe total de la factura (número)
- partidas: por cada renglón de productos:
  - descripcion: descripción tal como aparece
  - codigo_proveedor: el código/SKU/clave INTERNO que el PROVEEDOR usa para identificar ese producto en
    su propio catálogo (no el nuestro). CUIDADO: muchas facturas imprimen, pegado justo ANTES de la
    descripción (en la misma línea, ej. "1627 APOSITO TEGADERM..."), una referencia o clave del
    FABRICANTE/marca — esa NO es el código del proveedor, es solo un dato de referencia del producto.
    El código real que identifica al proveedor casi siempre aparece en una línea aparte INMEDIATAMENTE
    DESPUÉS de la descripción (ej. "3M 004"). Si ves ambos, usa el que viene después de la descripción,
    no el que está pegado antes. Vacío "" si no aparece ninguno con claridad.
  - referencia_fabricante: la referencia/clave del FABRICANTE o marca (la que va pegada antes de la
    descripción, ej. "1627" en el ejemplo anterior) si aparece por separado del código del proveedor.
    Vacío "" si no aparece o si es el mismo valor que ya pusiste en codigo_proveedor.
  - cantidad: número de unidades
  - numero_lote: número de lote impreso para esa partida, vacío "" si no aparece
  - fecha_caducidad: fecha de caducidad de esa partida (YYYY-MM-DD), vacío "" si no aparece

REGLAS IMPORTANTES:
1. NUNCA inventes un lote o fecha de caducidad que no esté impreso: si no aparece, deja el campo vacío "".
2. Preserva descripciones y códigos tal como aparecen, sin corregir ortografía.
3. Si una línea es encabezado, totales o pie de página, IGNÓRALA.
4. Responde ÚNICAMENTE con JSON válido, sin texto adicional.

Formato de respuesta:
{
  "rfc_emisor": "ABC010101AB1",
  "folio": "A-1234",
  "uuid": "",
  "fecha": "2026-06-15",
  "total": 12500.50,
  "partidas": [
    { "descripcion": "Guantes nitrilo talla M paq 100", "codigo_proveedor": "GN-M-100", "referencia_fabricante": "", "cantidad": 10, "numero_lote": "L2026-045", "fecha_caducidad": "2028-06-01" }
  ],
  "confianza": "alta|media|baja",
  "notas_extractor": "observaciones generales sobre la extracción"
}`;

async function extraerFactura(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const textoRaw = data.text;

  if (!textoRaw || textoRaw.trim().length < 20) {
    throw new Error('El PDF no contiene texto extraíble. Puede ser un escaneo (imagen) de baja calidad.');
  }

  const { text: responseText, tokens } = await extraerJSON({
    system: INSTRUCCIONES_EXTRACTOR,
    user: `TEXTO DE LA FACTURA:\n---\n${textoRaw.slice(0, 12000)}\n---`,
    maxTokens: 4096,
  });

  const jsonMatch = (responseText || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('La IA no devolvió un JSON válido al extraer la factura.');
  }
  const parsed = JSON.parse(jsonMatch[0]);

  if (!Array.isArray(parsed.partidas) || !parsed.partidas.length) {
    throw new Error('No se encontraron partidas en la factura.');
  }

  const partidas = parsed.partidas.map((p) => ({
    descripcion:          String(p.descripcion || '').trim(),
    codigo_proveedor:     String(p.codigo_proveedor || '').trim(),
    referencia_fabricante: String(p.referencia_fabricante || '').trim() || null,
    cantidad:             parseFloat(p.cantidad) || 0,
    numero_lote:          String(p.numero_lote || '').trim() || null,
    fecha_caducidad:      String(p.fecha_caducidad || '').trim() || null,
  }));

  // Defensa adicional al prompt: nuestro propio RFC (receptor) nunca es un proveedor válido,
  // sin importar qué tan bien o mal haya leído la IA el PDF.
  const rfcExtraido = String(parsed.rfc_emisor || '').trim().toUpperCase();
  const rfcPropio = String(process.env.EMPRESA_RFC || '').trim().toUpperCase();
  const rfcEmisor = (rfcPropio && rfcExtraido === rfcPropio) ? '' : rfcExtraido;

  return {
    rfc_emisor: rfcEmisor,
    folio: String(parsed.folio || '').trim(),
    uuid: String(parsed.uuid || '').trim().toUpperCase() || null,
    fecha: String(parsed.fecha || '').trim() || null,
    total: parseFloat(parsed.total) || null,
    partidas,
    confianza: parsed.confianza || 'media',
    notas_extractor: parsed.notas_extractor || '',
    tokens_usados: tokens,
  };
}

module.exports = { extraerFactura };
