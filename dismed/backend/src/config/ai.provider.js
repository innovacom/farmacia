/**
 * ai.provider.js — Capa de proveedor de IA unificada (sustituye el acceso directo
 * a la API de Anthropic en parser.pdf, matcher.ia y buscador.web).
 *
 * Motivación: la API de Claude cobra por uso. El ~99.8% del costo provenía del
 * tool server-side `web_search` de Anthropic ($10/1000 búsquedas + tokens). Este
 * módulo permite usar Google Gemini (free tier) con Google Search grounding como
 * reemplazo gratuito, manteniendo Anthropic como fallback para no romper producción.
 *
 * Selección de proveedor (variable de entorno AI_PROVIDER):
 *   - "gemini"    -> usa Google Gemini (requiere GEMINI_API_KEY)
 *   - "anthropic" -> usa Claude (requiere ANTHROPIC_API_KEY)
 *   - sin definir -> "gemini" si hay GEMINI_API_KEY, si no "anthropic"
 *
 * Expone dos funciones de alto nivel:
 *   - extraerJSON({ system, user, maxTokens })  -> { text, tokens }   (sin web)
 *   - buscarConWeb({ prompt, maxTokens })        -> { text, tokens }   (con búsqueda web)
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const PROVIDER = (
  process.env.AI_PROVIDER || (GEMINI_API_KEY ? 'gemini' : 'anthropic')
).toLowerCase();

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// -------------------------------------------------------------------------
// Backend Gemini (REST, sin SDK — usa fetch global de Node 18+)
// -------------------------------------------------------------------------

// Reintenta en errores transitorios de Gemini (429 rate limit, 5xx sobrecarga).
// El free tier devuelve 503 "high demand" de forma intermitente.
async function geminiFetchConReintentos(url, body, intentos = 3) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(body),
    });
    if (resp.ok) return resp.json();

    const detalle = await resp.text().catch(() => '');
    ultimoError = new Error(`Gemini API ${resp.status}: ${detalle.slice(0, 500)}`);
    const transitorio = resp.status === 429 || resp.status >= 500;
    if (!transitorio || i === intentos - 1) throw ultimoError;
    await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i))); // 0.8s, 1.6s
  }
  throw ultimoError;
}

async function geminiGenerate({ system, user, maxTokens, web }) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY no está configurada en el entorno (.env).');
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { maxOutputTokens: maxTokens || 4096, temperature: 0 },
  };

  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  if (web) {
    // Google Search grounding reemplaza al tool web_search de Anthropic.
    // No se puede combinar con responseMimeType=application/json en 2.5-flash,
    // así que el JSON se pide en el prompt y se extrae por regex.
    body.tools = [{ google_search: {} }];
  } else {
    // Salida JSON garantizada (reemplaza la extracción por regex del parser/matcher).
    body.generationConfig.responseMimeType = 'application/json';
    // gemini-2.5-flash trae "thinking" activado: con max_tokens bajos el razonamiento
    // consume el presupuesto y deja la respuesta vacía. Estas son tareas de extracción
    // estructurada que no requieren thinking, así que lo desactivamos.
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`;
  const data = await geminiFetchConReintentos(url, body);
  const cand = data.candidates && data.candidates[0];
  const text = (cand && cand.content && Array.isArray(cand.content.parts))
    ? cand.content.parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('')
    : '';

  const usage = data.usageMetadata || {};
  const tokens = (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0);

  return { text, tokens };
}

// -------------------------------------------------------------------------
// Backend Anthropic (fallback — reutiliza el cliente compartido existente)
// -------------------------------------------------------------------------

async function anthropicGenerate({ system, user, maxTokens, web }) {
  const { client, MODEL } = require('./anthropic');

  const params = {
    model: MODEL,
    max_tokens: maxTokens || 4096,
    messages: [{ role: 'user', content: user }],
  };

  if (system) {
    params.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  }

  if (web) {
    params.tools = [{
      type: 'web_search_20260209',
      name: 'web_search',
      max_uses: 10,
      user_location: { type: 'approximate', country: 'MX', timezone: 'America/Mexico_City' },
    }];

    // Los tools server-side pueden devolver pause_turn; reenviar para continuar.
    let messages = params.messages;
    let response;
    for (let intento = 0; intento < 4; intento++) {
      response = await client.messages.create({ ...params, messages });
      if (response.stop_reason !== 'pause_turn') break;
      messages = [
        { role: 'user', content: user },
        { role: 'assistant', content: response.content },
      ];
    }
    const text = (response.content || [])
      .filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const tokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
    return { text, tokens };
  }

  const message = await client.messages.create(params);
  const text = (message.content || [])
    .filter((b) => b.type === 'text').map((b) => b.text).join('');
  const tokens = (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0);
  return { text, tokens };
}

// -------------------------------------------------------------------------
// API pública
// -------------------------------------------------------------------------

/**
 * Despacha al backend seleccionado. Si el proveedor es Gemini y falla (p. ej. el
 * free tier devuelve 503/agotó cuota), hace fallback automático a Anthropic
 * cuando hay ANTHROPIC_API_KEY, para no romper el flujo del usuario en producción.
 */
async function despachar(args) {
  if (PROVIDER === 'anthropic') return anthropicGenerate(args);
  try {
    return await geminiGenerate(args);
  } catch (e) {
    if (process.env.ANTHROPIC_API_KEY) {
      console.warn('[ai.provider] Gemini no disponible, usando fallback Anthropic:', e.message);
      return anthropicGenerate(args);
    }
    throw e;
  }
}

/**
 * Extracción/clasificación sin web. Devuelve { text, tokens }.
 * text es JSON (con Gemini se fuerza application/json; con Anthropic puede traer texto).
 */
async function extraerJSON({ system, user, maxTokens }) {
  return despachar({ system, user, maxTokens, web: false });
}

/**
 * Generación con búsqueda web (precios). Devuelve { text, tokens }.
 * text es texto libre que contiene un bloque JSON (extraer con regex).
 */
async function buscarConWeb({ prompt, maxTokens }) {
  return despachar({ user: prompt, maxTokens, web: true });
}

module.exports = { extraerJSON, buscarConWeb, PROVIDER, GEMINI_MODEL };
