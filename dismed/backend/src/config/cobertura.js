/**
 * cobertura.js — Radio de cobertura de entrega a domicilio (km), configurable
 * por administradores. Mismo patrón de caché en memoria que precios.js.
 *
 * Guardado en la tabla `configuracion` (clave `radio_cobertura_km`, ver
 * migrate_v67) y editable desde la página Configuración (solo admin). Ver
 * src/services/cobertura.service.js para el cálculo de distancia real contra
 * la dirección del cliente.
 */
const { pool } = require('./db');

const DEFAULT_RADIO_KM = Math.max(0.1, parseFloat(process.env.RADIO_COBERTURA_KM) || 2);
const CLAVE = 'radio_cobertura_km';

let cache = DEFAULT_RADIO_KM;
let cargado = false;

/** Carga (o recarga) el valor desde la tabla `configuracion`. */
async function cargar() {
  try {
    const [[row]] = await pool.query('SELECT valor FROM configuracion WHERE clave = ?', [CLAVE]);
    if (row) {
      const n = parseFloat(row.valor);
      if (Number.isFinite(n) && n > 0) cache = n;
    }
  } catch (e) {
    // Tabla aún no migrada u otro problema: se mantiene el default.
  }
  cargado = true;
  return cache;
}

/** Devuelve el radio vigente en km (carga perezosa la primera vez). */
async function getRadioCoberturaKm() {
  if (!cargado) await cargar();
  return cache;
}

/** Actualiza la copia en memoria tras un guardado (evita releer la BD). */
function aplicar(valor) {
  const n = parseFloat(valor);
  if (Number.isFinite(n) && n > 0) cache = n;
  return cache;
}

module.exports = { getRadioCoberturaKm, cargar, aplicar, DEFAULT_RADIO_KM, CLAVE };
