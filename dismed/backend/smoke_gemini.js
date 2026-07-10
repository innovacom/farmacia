/* Prueba EN VIVO de Gemini (hace llamadas reales, consume cuota gratuita).
 * Requiere GEMINI_API_KEY en el entorno o en .env.
 * Ejecutar desde dismed/backend:
 *     node -r dotenv/config smoke_gemini.js
 * o:  GEMINI_API_KEY=xxxx node smoke_gemini.js
 */
process.env.AI_PROVIDER = 'gemini';

if (!process.env.GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY. Usa:  node -r dotenv/config smoke_gemini.js');
  process.exit(1);
}

require('./src/modules/solicitudes/parser.pdf'); // valida carga
const { desempatarConIA } = require('./src/modules/solicitudes/matcher.ia');
const { buscarPrecioWeb } = require('./src/modules/solicitudes/buscador.web');

(async () => {
  console.log('1) Desempate IA (extraccion JSON, sin web)...');
  const elec = await desempatarConIA({
    descripcion: 'Jeringa desechable 5 ml con aguja 21G',
    candidatos: [
      { id: 1, sku_interno: 'DM-1', descripcion: 'Jeringa 10 ml' },
      { id: 2, sku_interno: 'DM-2', descripcion: 'Jeringa 5 ml aguja 21G' },
    ],
  });
  console.log('   ->', JSON.stringify(elec));

  console.log('2) Busqueda de precio web (grounding Google Search)...');
  const res = await buscarPrecioWeb({
    descripcion_original: 'Guantes de nitrilo talla M caja con 100 piezas',
    codigo_cliente: '', codigo_gobierno: '', cantidad: 1, unidad_medida: 'caja',
  });
  console.log('   identificacion:', JSON.stringify(res.identificacion));
  console.log('   ofertas:', JSON.stringify(res.ofertas, null, 2));
  console.log('   tokens_usados:', res.tokens_usados);

  console.log('\nSmoke test OK. Gemini responde correctamente.');
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
