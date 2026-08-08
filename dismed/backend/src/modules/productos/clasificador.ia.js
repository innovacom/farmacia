/**
 * clasificador.ia.js — Clasificación automática por IA de productos NUEVOS que
 * llegan sin taxonomía (familia/categoría/subcategoría) ni clasificación COFEPRIS,
 * como los que se dan de alta solos al cargar una factura de proveedor
 * (inventario/facturas.controller.js) donde el XML no trae esos datos.
 *
 * Es un best-effort: si Gemini no está configurado o falla, no bloquea el alta del
 * producto — simplemente no se rellena nada y el llamador sigue el flujo normal
 * (el producto queda como hoy, editable a mano). Usa la capa ai.provider (Gemini),
 * igual que matcher.ia.js.
 */
const { extraerJSON } = require('../../config/ai.provider');

// Debe coincidir con el ENUM de productos.clasificacion_cofepris (migrate_v28, LGS Art. 226).
const COFEPRIS_VALORES = ['libre', 'venta_farmacia', 'antibiotico', 'fraccion_i', 'fraccion_ii', 'fraccion_iii'];

// Productos por llamada a Gemini: limita tokens de la respuesta y respeta el rate
// limit del free tier (~18 req/min compartido con el resto del sistema).
const LOTE = 25;

function construirPrompt(lote, familiasExistentes) {
  const listaFamilias = familiasExistentes.length
    ? familiasExistentes.join(', ')
    : '(sin familias registradas aún, propón las que consideres adecuadas)';

  const items = lote.map((p, i) =>
    `${i + 1}. ${p.descripcion}` +
    (p.clave_sat ? ` | clave SAT: ${p.clave_sat}` : '') +
    (p.fabricante ? ` | fabricante: ${p.fabricante}` : '')
  ).join('\n');

  return `Eres un experto en clasificación de insumos médicos y medicamentos para una distribuidora en México.

Para cada producto de la lista, determina:
1. "familia": categoría amplia del producto (ej. "MATERIAL DE CURACION", "MEDICAMENTOS", "EQUIPO MEDICO"). Reutiliza EXACTAMENTE uno de estos nombres si aplica: ${listaFamilias}. Si ninguno aplica, propone un nombre breve en MAYÚSCULAS.
2. "categoria": subdivisión dentro de la familia (ej. "ANTIBIOTICOS", "GASAS", "OXIGENOTERAPIA"), en MAYÚSCULAS.
3. "subcategoria": subdivisión más específica dentro de la categoría, en MAYÚSCULAS.
4. "clasificacion_cofepris": según la Ley General de Salud Art. 226 (México), UNO de estos valores EXACTOS:
   - "libre": venta libre sin restricción (material de curación, equipo, insumos no farmacológicos).
   - "venta_farmacia": medicamento de venta libre pero solo en farmacia, no requiere receta.
   - "antibiotico": antibiótico (fracción IV), requiere receta médica que se retiene en la farmacia.
   - "fraccion_i": estupefaciente, requiere receta especial.
   - "fraccion_ii": psicotrópico de control estricto, requiere receta especial retenida.
   - "fraccion_iii": psicotrópico, requiere receta médica que se retiene.
   Si el producto NO es un medicamento (material de curación, equipo, consumibles), usa "libre".

Si para algún producto NO puedes determinar con confianza razonable la familia/categoría/subcategoría (descripción demasiado ambigua o genérica), usa null en esos tres campos para ese producto — no inventes al azar. "clasificacion_cofepris" siempre debe llevar uno de los valores exactos de la lista (usa "libre" si no es medicamento o no estás seguro).

PRODUCTOS:
${items}

Responde ÚNICAMENTE con un JSON array de ${lote.length} elementos, en el mismo orden que la lista, uno por producto:
[{ "familia": "..."|null, "categoria": "..."|null, "subcategoria": "..."|null, "clasificacion_cofepris": "..." }, ...]`;
}

async function clasificarLote(lote, familiasExistentes) {
  const prompt = construirPrompt(lote, familiasExistentes);
  const { text } = await extraerJSON({ user: prompt, maxTokens: 4096 });
  const m = text.match(/\[[\s\S]*\]/);
  const parsed = JSON.parse(m ? m[0] : text);
  if (!Array.isArray(parsed)) throw new Error('Respuesta de IA no es un array');

  return lote.map((_, i) => {
    const r = parsed[i];
    const familia = r?.familia ? String(r.familia).trim().toUpperCase().slice(0, 100) : null;
    const categoria = r?.categoria ? String(r.categoria).trim().toUpperCase().slice(0, 100) : null;
    const subcategoria = r?.subcategoria ? String(r.subcategoria).trim().toUpperCase().slice(0, 100) : null;
    const cofepris = COFEPRIS_VALORES.includes(r?.clasificacion_cofepris) ? r.clasificacion_cofepris : 'libre';
    // Sin familia no hay jerarquía completa que resolver — se cuenta como "no clasificado"
    // aunque sí se aproveche la clasificación COFEPRIS (siempre viene con un valor válido).
    if (!familia) return { familia: null, categoria: null, subcategoria: null, clasificacion_cofepris: cofepris, _sinTaxonomia: true };
    return { familia, categoria, subcategoria, clasificacion_cofepris: cofepris, _sinTaxonomia: false };
  });
}

/**
 * Clasifica un lote de productos NUEVOS (sin familia/categoría/subcategoría) por IA.
 * @param {Array<{descripcion:string, clave_sat?:string, fabricante?:string}>} productos
 * @param {string[]} familiasExistentes  nombres de familias ya registradas (para reusarlas)
 * @returns {{ resultados: Array<object|null>, noClasificados: number }}
 *   `resultados` está alineado por índice con `productos`; cada entrada es
 *   { familia, categoria, subcategoria, clasificacion_cofepris } o null si no se pudo
 *   determinar la familia para ese producto (aún así puede aplicar solo el fallback
 *   "libre" en clasificacion_cofepris — el llamador decide si lo usa).
 */
async function clasificarProductosNuevos(productos, familiasExistentes = []) {
  const resultados = new Array(productos.length).fill(null);
  if (!process.env.GEMINI_API_KEY || !productos.length) {
    return { resultados, noClasificados: productos.length };
  }

  let noClasificados = 0;
  for (let i = 0; i < productos.length; i += LOTE) {
    const lote = productos.slice(i, i + LOTE);
    try {
      const clasif = await clasificarLote(lote, familiasExistentes);
      clasif.forEach((c, j) => {
        resultados[i + j] = c;
        if (c._sinTaxonomia) noClasificados++;
      });
    } catch (e) {
      console.warn('[clasificador.ia] lote falló, se omite clasificación IA para este lote:', e.message);
      noClasificados += lote.length;
    }
  }
  return { resultados, noClasificados };
}

module.exports = { clasificarProductosNuevos, COFEPRIS_VALORES };
