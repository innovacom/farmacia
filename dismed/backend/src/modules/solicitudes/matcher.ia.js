/**
 * matcher.ia.js — Desempate por IA (Fase 4) entre el shortlist del matcher.
 *
 * Constraint anti-alucinación: la IA SOLO puede elegir un producto de la lista
 * cerrada de candidatos (o devolver null). No puede inventar SKUs. Sigue siendo
 * una SUGERENCIA: el usuario confirma en la UI (la decisión de negocio no cambia).
 *
 * Reutiliza el cliente Anthropic, igual que buscador.web.js.
 */
const { extraerJSON } = require('../../config/ai.provider');

/**
 * @param {object} args
 * @param {string} args.descripcion        descripción original de la solicitud
 * @param {string} [args.codigo_cliente]
 * @param {string} [args.codigo_gobierno]
 * @param {Array}  args.candidatos         shortlist [{ id, sku_interno, descripcion, fabricante, ... }]
 * @returns {{ producto_id:number|null, confianza:'alta'|'media'|'baja', justificacion:string }}
 */
async function desempatarConIA({ descripcion, codigo_cliente, codigo_gobierno, candidatos }) {
  const lista = candidatos.map((c, i) =>
    `${i + 1}. id=${c.id} | SKU ${c.sku_interno} | ${c.descripcion}` +
    (c.fabricante ? ` | fabricante: ${c.fabricante}` : '')
  ).join('\n');

  const idsValidos = candidatos.map((c) => c.id);

  const prompt = `Eres un experto en insumos médicos de una distribuidora en México.
Debes decidir cuál de los productos del CATÁLOGO corresponde EXACTAMENTE al producto solicitado.

PRODUCTO SOLICITADO:
- Descripción: ${descripcion}
- Código del cliente: ${codigo_cliente || '(no disponible)'}
- Clave de gobierno / cuadro básico: ${codigo_gobierno || '(no disponible)'}

CANDIDATOS DEL CATÁLOGO (elige SOLO uno de esta lista, por su id):
${lista}

REGLAS ESTRICTAS:
- Solo puedes elegir un "producto_id" que esté en la lista de candidatos. NO inventes ids ni SKUs.
- Las MEDIDAS deben coincidir (mililitros, miligramos, calibre, tamaño, %). Una jeringa de 5 ML NO es una de 10 ML.
- La presentación y la sustancia/material deben ser congruentes.
- Si NINGÚN candidato corresponde con seguridad razonable, devuelve "producto_id": null.

Responde ÚNICAMENTE con JSON válido, sin texto adicional:
{ "producto_id": <id de la lista o null>, "confianza": "alta|media|baja", "justificacion": "breve explicación" }`;

  const { text: texto } = await extraerJSON({ user: prompt, maxTokens: 500 });

  let parsed;
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : texto);
  } catch {
    return { producto_id: null, confianza: 'baja', justificacion: 'No se pudo interpretar la respuesta de la IA.' };
  }

  // Lista cerrada: descartar cualquier id que la IA no haya tomado del shortlist
  let pid = parsed.producto_id;
  if (pid != null) pid = Number(pid);
  if (!idsValidos.includes(pid)) pid = null;

  return {
    producto_id: pid,
    confianza: ['alta', 'media', 'baja'].includes(parsed.confianza) ? parsed.confianza : 'baja',
    justificacion: String(parsed.justificacion || '').substring(0, 400),
  };
}

module.exports = { desempatarConIA };
