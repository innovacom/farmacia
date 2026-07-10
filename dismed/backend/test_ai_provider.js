/* Prueba offline del proveedor de IA: carga de módulos + parseo del backend Gemini
 * con fetch simulado (sin key ni red). Ejecutar: node test_ai_provider.js  */
process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'TEST_FAKE_KEY';

let ok = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { ok++; console.log('  OK  ' + msg); } else { fail++; console.error('  FAIL ' + msg); } };

// 1) Carga de módulos (valida sintaxis + imports)
const provider = require('./src/config/ai.provider');
const parser   = require('./src/modules/solicitudes/parser.pdf');
const matcher  = require('./src/modules/solicitudes/matcher.ia');
const buscador = require('./src/modules/solicitudes/buscador.web');
assert(typeof provider.extraerJSON === 'function', 'ai.provider.extraerJSON exportada');
assert(typeof provider.buscarConWeb === 'function', 'ai.provider.buscarConWeb exportada');
assert(typeof parser.parsePdf === 'function', 'parser.pdf carga y exporta parsePdf');
assert(typeof matcher.desempatarConIA === 'function', 'matcher.ia carga y exporta desempatarConIA');
assert(typeof buscador.buscarPrecioWeb === 'function', 'buscador.web carga y exporta buscarPrecioWeb');
assert(provider.PROVIDER === 'gemini', 'PROVIDER seleccionado = gemini');

// 2) Backend Gemini: extraerJSON (modo JSON, sin web)
let capturado = null;
global.fetch = async (url, opts) => {
  capturado = { url, body: JSON.parse(opts.body), headers: opts.headers };
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: '{"producto_id": 7, "confianza": "alta", "justificacion": "ok"}' }] } }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 },
    }),
  };
};

(async () => {
  const r = await provider.extraerJSON({ system: 'sys', user: 'hola', maxTokens: 500 });
  assert(r.text.includes('producto_id'), 'extraerJSON devuelve texto JSON');
  assert(r.tokens === 150, 'extraerJSON suma tokens (120+30=150)');
  assert(capturado.url.includes(':generateContent'), 'usa endpoint generateContent');
  assert(capturado.headers['x-goog-api-key'] === 'TEST_FAKE_KEY', 'manda API key en header');
  assert(capturado.body.generationConfig.responseMimeType === 'application/json', 'fuerza JSON en modo sin web');
  assert(!capturado.body.tools, 'sin web NO incluye tools');
  assert(capturado.body.systemInstruction.parts[0].text === 'sys', 'pasa systemInstruction');

  // matcher usa extraerJSON -> debe elegir el id válido del shortlist
  const eleccion = await matcher.desempatarConIA({
    descripcion: 'jeringa 5ml', candidatos: [{ id: 7, sku_interno: 'DM-7', descripcion: 'jeringa 5ml' }],
  });
  assert(eleccion.producto_id === 7, 'matcher.desempatarConIA elige id válido (7)');

  // 3) Backend Gemini: buscarConWeb (grounding, sin responseMimeType)
  global.fetch = async (url, opts) => {
    capturado = { url, body: JSON.parse(opts.body) };
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Encontré esto: {"identificacion":{"producto":"x","confianza":"alta"},"ofertas":[{"tienda":"MediFacil","url":"https://medifacil.com/p","precio_mxn":50,"notas":""}]}' }] } }],
        usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 200 },
      }),
    };
  };
  const w = await buscador.buscarPrecioWeb({ descripcion_original: 'guantes', cantidad: 1, unidad_medida: 'caja' });
  assert(capturado.body.tools && capturado.body.tools[0].google_search, 'con web incluye tool google_search');
  assert(!capturado.body.generationConfig.responseMimeType, 'con web NO fuerza responseMimeType');
  assert(w.ofertas.length === 1 && w.ofertas[0].precio_mxn === 50, 'buscarPrecioWeb parsea oferta del grounding');
  assert(w.tokens_usados === 1000, 'buscarPrecioWeb reporta tokens (800+200=1000)');

  console.log(`\nResultado: ${ok} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR inesperado:', e); process.exit(1); });
