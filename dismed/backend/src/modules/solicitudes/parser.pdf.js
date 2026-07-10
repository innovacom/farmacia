const fs = require('fs');
const pdfParse = require('pdf-parse');
const { extraerJSON } = require('../../config/ai.provider');

// Instrucciones estáticas del parser. Se mandan como bloque `system` cacheable
// (prompt caching): no cambian entre solicitudes, así que la API las reutiliza
// y solo se factura/procesa de nuevo el texto variable del documento.
const INSTRUCCIONES_PARSER = `Eres un asistente especializado en documentos de compras para distribuidoras de insumos médicos en México.

Analiza el texto extraído de un documento de solicitud de cotización o requisición de compra y extrae TODAS las partidas de productos.

Para cada partida identifica:
- codigo_cliente: código o número de parte exacto que usa el cliente (puede estar vacío)
- descripcion_original: descripción completa del producto TAL COMO APARECE en el documento, sin modificar
- cantidad: número que indica cuántas unidades solicitan (default 1 si no está claro)
- unidad_medida: unidad (pza, caja, par, lt, kg, etc.) - default "pza" si no está claro
- observaciones: cualquier nota adicional de esa partida (marca requerida, especificaciones, etc.)

REGLAS IMPORTANTES:
1. Preserva la descripción EXACTAMENTE como aparece en el documento, sin corregir ortografía
2. Si el código de cliente no está claro o no existe, deja codigo_cliente vacío ""
3. Si una línea es encabezado, pie de página o información de la empresa, IGNÓRALA
4. Responde ÚNICAMENTE con JSON válido, sin texto adicional

Formato de respuesta:
{
  "partidas": [
    {
      "linea": 1,
      "codigo_cliente": "HRN-MED-0042",
      "descripcion_original": "Guantes nitrilo talla M paq 100",
      "cantidad": 10,
      "unidad_medida": "caja",
      "observaciones": "Marca Kimberly-Clark"
    }
  ],
  "confianza": "alta|media|baja",
  "notas_parser": "observaciones generales sobre la extracción"
}`;

/**
 * Extrae partidas de un PDF usando la API de Anthropic.
 * Retorna array de partidas con: codigo_cliente, descripcion_original, cantidad, unidad_medida.
 */
async function parsePdf(filePath) {
  // Primero extraer texto crudo del PDF
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const textoRaw = data.text;

  if (!textoRaw || textoRaw.trim().length < 20) {
    throw new Error('El PDF no contiene texto extraíble. Puede ser un PDF escaneado (imagen).');
  }

  const { text: responseText, tokens } = await extraerJSON({
    system: INSTRUCCIONES_PARSER,
    user: `TEXTO DEL DOCUMENTO:\n---\n${textoRaw.slice(0, 8000)}\n---`,
    maxTokens: 4096,
  });

  // Parsear JSON de la respuesta (Gemini fuerza application/json; aun así
  // extraemos el bloque {...} por robustez si llega texto adicional).
  const jsonMatch = (responseText || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('La IA no devolvió un JSON válido. Intenta con captura manual.');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (!Array.isArray(parsed.partidas) || !parsed.partidas.length) {
    throw new Error('No se encontraron partidas en el PDF. Verifica el documento o usa captura manual.');
  }

  // Normalizar y asegunar campos
  const partidas = parsed.partidas.map((p, i) => ({
    linea:               p.linea || i + 1,
    codigo_cliente:      String(p.codigo_cliente || '').trim(),
    descripcion_original: String(p.descripcion_original || '').trim(),
    cantidad:            parseFloat(p.cantidad) || 1,
    unidad_medida:       String(p.unidad_medida || 'pza').trim().toLowerCase(),
    observaciones:       String(p.observaciones || '').trim(),
  }));

  return {
    partidas,
    confianza:    parsed.confianza || 'media',
    notas_parser: parsed.notas_parser || '',
    tokens_usados: tokens,
  };
}

module.exports = { parsePdf };
