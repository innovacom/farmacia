/**
 * ai.provider.js — Capa de proveedor de IA (usada por parser.pdf, matcher.ia y
 * buscador.web en vez de llamar a una API de IA directamente).
 *
 * Usa Google Gemini (free tier) con Google Search grounding para búsqueda de
 * precios, y generación normal con salida JSON forzada para extracción/clasificación.
 * No hay fallback a ningún proveedor de pago: si Gemini agota su cuota gratis
 * tras los reintentos, se informa un error claro (503) en vez de gastar dinero.
 *
 * Requiere GEMINI_API_KEY en el entorno (.env).
 *
 * Expone dos funciones de alto nivel:
 *   - extraerJSON({ system, user, maxTokens })  -> { text, tokens }   (sin web)
 *   - buscarConWeb({ prompt, maxTokens })        -> { text, tokens }   (con búsqueda web)
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// El free tier de Gemini limita a ~20 requests/min (compartido entre búsquedas
// con grounding y generación normal, y entre TODAS las llamadas de este proceso:
// parser, matcher y búsqueda web usan la misma cola). Sin este límite, un lote
// de partidas dispara 429 casi de inmediato. Se espacian las llamadas para no
// llegar nunca al límite.
const INTERVALO_MIN_MS = 3300; // ~18 req/min, margen bajo el límite de 20/min
let proximaLlamadaDisponible = 0;

async function esperarTurnoGemini() {
  const ahora = Date.now();
  const espera = proximaLlamadaDisponible - ahora;
  proximaLlamadaDisponible = Math.max(ahora, proximaLlamadaDisponible) + INTERVALO_MIN_MS;
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
}

// Google incluye en el 429 cuánto hay que esperar realmente (p. ej. "retryDelay":"47s"
// o "...Please retry in 47.37s."). Ese tiempo suele ser bastante mayor que un backoff
// exponencial corto, así que se respeta tal cual en vez de rendirse antes de tiempo.
function extraerEsperaMs(detalle) {
  const m = detalle.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)
    || detalle.match(/retry in ([\d.]+)s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

// Reintenta en errores transitorios de Gemini (429 rate limit, 5xx sobrecarga).
// El free tier devuelve 503 "high demand" de forma intermitente.
async function geminiFetchConReintentos(url, body, intentos = 4) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    await esperarTurnoGemini();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(body),
    });
    if (resp.ok) return resp.json();

    const detalle = await resp.text().catch(() => '');
    ultimoError = new Error(`Gemini API ${resp.status}: ${detalle.slice(0, 500)}`);
    const esUltimoIntento = i === intentos - 1;

    if (resp.status === 429) {
      const esperaReal = extraerEsperaMs(detalle);
      if (esperaReal && !esUltimoIntento) {
        await new Promise((r) => setTimeout(r, Math.min(esperaReal, 60000) + 250));
        continue;
      }
    }
    const transitorio = resp.status === 429 || resp.status >= 500;
    if (!transitorio || esUltimoIntento) throw ultimoError;
    await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i))); // 0.8s, 1.6s...
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
    // Google Search grounding para obtener precios reales de internet.
    // No se puede combinar con responseMimeType=application/json en 2.5-flash,
    // así que el JSON se pide en el prompt y se extrae por regex.
    body.tools = [{ google_search: {} }];
  } else {
    // Salida JSON garantizada (evita la extracción por regex del parser/matcher).
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
// API pública
// -------------------------------------------------------------------------

// Si Gemini no responde tras los reintentos (cuota agotada bajo ráfaga), se
// informa con un mensaje claro y un 503 en vez de propagar el error crudo de
// Google — no hay proveedor de pago al que caer de respaldo.
async function conMensajeClaro(fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn('[ai.provider] Gemini no disponible:', e.message);
    const err = new Error('Búsqueda de IA no disponible por el momento (límite de uso alcanzado). Intenta de nuevo en unos minutos.');
    err.status = 503;
    err.cause = e;
    throw err;
  }
}

/**
 * Extracción/clasificación sin web. Devuelve { text, tokens }.
 * text es JSON (se fuerza application/json en la llamada a Gemini).
 */
async function extraerJSON({ system, user, maxTokens }) {
  return conMensajeClaro(() => geminiGenerate({ system, user, maxTokens, web: false }));
}

/**
 * Generación con búsqueda web (precios). Devuelve { text, tokens }.
 * text es texto libre que contiene un bloque JSON (extraer con regex).
 */
async function buscarConWeb({ prompt, maxTokens }) {
  return conMensajeClaro(() => geminiGenerate({ user: prompt, maxTokens, web: true }));
}

module.exports = { extraerJSON, buscarConWeb, GEMINI_MODEL };
