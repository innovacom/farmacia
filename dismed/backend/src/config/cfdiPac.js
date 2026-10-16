/**
 * cfdiPac.js — PAC de timbrado CFDI y ambiente, editables desde Configuración (admin).
 *
 * Se guardan en la tabla `configuracion` (claves cfdi_pac, cfdi_ambiente). Si no hay
 * fila, se usan las variables de entorno CFDI_PAC / CFDI_AMBIENTE y, al final, los
 * defaults (facturama / sandbox). Se lee de BD en cada timbrado/cancelación: son
 * operaciones poco frecuentes y así el cambio aplica de inmediato en todos los
 * procesos PM2 (cluster) sin reiniciar.
 */
const { pool } = require('./db');

const PACS = ['facturama', 'facturadigital'];
const AMBIENTES = ['sandbox', 'produccion'];

function normalizaAmbiente(v) {
  return String(v || '').trim().toLowerCase().startsWith('prod') ? 'produccion' : 'sandbox';
}

async function getCfdiConfig() {
  let pac = String(process.env.CFDI_PAC || 'facturama').trim().toLowerCase();
  let ambiente = normalizaAmbiente(process.env.CFDI_AMBIENTE);
  try {
    const [rows] = await pool.query(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('cfdi_pac','cfdi_ambiente')"
    );
    for (const r of rows) {
      if (r.clave === 'cfdi_pac' && PACS.includes(r.valor)) pac = r.valor;
      if (r.clave === 'cfdi_ambiente' && AMBIENTES.includes(r.valor)) ambiente = r.valor;
    }
  } catch (_) { /* tabla no disponible: se queda el entorno */ }
  if (!PACS.includes(pac)) {
    const e = new Error(`CFDI_PAC inválido: "${pac}" (use facturama o facturadigital)`); e.status = 500; throw e;
  }
  return { pac, ambiente };
}

async function setCfdiConfig({ pac, ambiente }) {
  const filas = [];
  if (pac !== undefined) filas.push(['cfdi_pac', pac, 'PAC de timbrado CFDI (facturama | facturadigital)']);
  if (ambiente !== undefined) filas.push(['cfdi_ambiente', ambiente, 'Ambiente de timbrado CFDI (sandbox | produccion)']);
  for (const [clave, valor, descripcion] of filas) {
    await pool.query(
      'INSERT INTO configuracion (clave, valor, descripcion) VALUES (?,?,?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
      [clave, valor, descripcion]
    );
  }
  return getCfdiConfig();
}

module.exports = { getCfdiConfig, setCfdiConfig, PACS, AMBIENTES };
