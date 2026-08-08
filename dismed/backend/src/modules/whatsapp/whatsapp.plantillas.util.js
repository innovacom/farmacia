/**
 * whatsapp.plantillas.util.js — lee la forma de una plantilla de Meta
 * (componentes tal como los regresa GET /message_templates) y decide si el
 * envío masivo la puede usar. Para no reinventar un editor de plantillas
 * completo (fase 2, ver README), la v1 del envío masivo solo soporta:
 *   - Plantillas sin variables (mensaje fijo), o
 *   - Plantillas con EXACTAMENTE 1 variable de texto en header y/o body
 *     (normalmente el nombre del destinatario).
 * Header de tipo IMAGE/VIDEO/DOCUMENT (requiere subir media aparte) y
 * plantillas con 2+ variables se marcan como no soportadas.
 */

const RE_VAR = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function variablesDeTexto(texto) {
  const out = [];
  let m;
  RE_VAR.lastIndex = 0;
  while ((m = RE_VAR.exec(texto || ''))) out.push(m[1]);
  return out;
}

// Analiza una plantilla (tal como la regresa listarPlantillasAprobadas) y
// regresa { soportada, motivo, variable, tieneHeaderMedia }.
function analizarPlantilla(template) {
  const componentes = template.components || [];
  const header = componentes.find((c) => c.type === 'HEADER');
  const body = componentes.find((c) => c.type === 'BODY');

  if (header && header.format && header.format !== 'TEXT') {
    return { soportada: false, motivo: `Encabezado tipo ${header.format} (requiere adjuntar media, aún no soportado)` };
  }

  const variables = [
    ...(header?.format === 'TEXT' ? variablesDeTexto(header.text) : []),
    ...variablesDeTexto(body?.text),
  ];
  const unicas = [...new Set(variables)];

  if (unicas.length > 1) {
    return { soportada: false, motivo: `Plantilla con ${unicas.length} variables (el envío masivo solo soporta 0 o 1)` };
  }

  return { soportada: true, variable: unicas[0] || null };
}

// Arma el arreglo `components` que espera Graph API para un envío puntual de
// esta plantilla, dado el valor a usar para su única variable (si tiene).
// Igual que enviarPlantillaRecordatorio: si la variable no es puramente
// numérica se manda como parameter_name (nombrada); si es "1", "2"... se
// manda posicional (Meta la resuelve por orden, sin parameter_name).
function armarComponentes(template, valorVariable) {
  const componentes = template.components || [];
  const header = componentes.find((c) => c.type === 'HEADER');
  const body = componentes.find((c) => c.type === 'BODY');
  const out = [];

  function parametro(nombreVar) {
    const esPosicional = /^\d+$/.test(nombreVar);
    return esPosicional
      ? { type: 'text', text: valorVariable }
      : { type: 'text', parameter_name: nombreVar, text: valorVariable };
  }

  if (header?.format === 'TEXT') {
    const vars = variablesDeTexto(header.text);
    if (vars.length) out.push({ type: 'header', parameters: [parametro(vars[0])] });
  }
  if (body?.text) {
    const vars = variablesDeTexto(body.text);
    if (vars.length) out.push({ type: 'body', parameters: [parametro(vars[0])] });
  }
  return out;
}

module.exports = { analizarPlantilla, armarComponentes, variablesDeTexto };
