/**
 * branding.service.js — Branding y parámetros por empresa (white-label POS).
 * Une `empresas` (logo, colores, tema, datos fiscales) + `empresas_config`
 * (clave-valor) con defaults. Caché en memoria con invalidación al editar
 * (mismo patrón que config/precios.js: la BD es la verdad, la copia en
 * memoria evita un query por request).
 *
 * Sin configurar nada, la empresa se ve como DISMED/INNOVACOM hoy
 * (colores actuales de tailwind.config.js y logo del Sidebar).
 */
const { pool } = require('../config/db');

// Catálogo de claves válidas de empresas_config (patrón META de configuracion.controller.js)
const CONFIG_META = {
  ticket_ancho_mm:                { label: 'Ancho del ticket (mm)', valores: ['58', '80'], default: '80' },
  ticket_leyenda_pie:             { label: 'Leyenda al pie del ticket', maxLen: 300, default: '¡Gracias por su compra!' },
  ticket_mostrar_leyenda_factura: { label: 'Mostrar leyenda de facturación en el ticket', valores: ['0', '1'], default: '1' },
  global_periodicidad_default:    { label: 'Periodicidad default de factura global', valores: ['01', '04'], default: '01' },
  pos_permitir_descuento:         { label: 'Permitir descuentos en mostrador', valores: ['0', '1'], default: '0' },
};

// Colores actuales de la paleta brand (tailwind.config.js) — fallback white-label
const DEFAULTS = {
  color_primario: '#1a6bb5',
  color_secundario: null,
  tema: 'claro',
};

const cache = new Map(); // empresaId -> branding

async function getBranding(empresaId) {
  if (cache.has(empresaId)) return cache.get(empresaId);

  const [[empresa]] = await pool.query('SELECT * FROM empresas WHERE id = ?', [empresaId]);
  if (!empresa) {
    const err = new Error('Empresa no encontrada'); err.status = 404; throw err;
  }
  const [cfgRows] = await pool.query(
    'SELECT clave, valor FROM empresas_config WHERE empresa_id = ?', [empresaId]
  );
  const config = {};
  for (const clave of Object.keys(CONFIG_META)) config[clave] = CONFIG_META[clave].default;
  for (const row of cfgRows) if (row.clave in CONFIG_META) config[row.clave] = row.valor;

  const branding = {
    empresa_id: empresa.id,
    nombre: empresa.nombre,
    nombre_comercial: empresa.nombre_comercial || empresa.nombre,
    rfc: empresa.rfc,
    regimen_fiscal: empresa.regimen_fiscal,
    codigo_postal: empresa.codigo_postal,
    logo_url: empresa.logo_path ? `/uploads/branding/${empresa.logo_path}` : null,
    logo_ticket_url: empresa.logo_ticket_path
      ? `/uploads/branding/${empresa.logo_ticket_path}`
      : (empresa.logo_path ? `/uploads/branding/${empresa.logo_path}` : null),
    color_primario: empresa.color_primario || DEFAULTS.color_primario,
    color_secundario: empresa.color_secundario || DEFAULTS.color_secundario,
    tema: empresa.tema || DEFAULTS.tema,
    config,
  };
  cache.set(empresaId, branding);
  return branding;
}

function invalidar(empresaId) {
  if (empresaId) cache.delete(Number(empresaId));
  else cache.clear();
}

module.exports = { getBranding, invalidar, CONFIG_META };
