/**
 * precios.js — Ventanas de vigencia de precios (configurables por administradores).
 *
 * Dos parámetros SEPARADOS, guardados en la tabla `configuracion` y editables desde
 * la página de Configuración (solo admin):
 *   - vigencia_catalogo_meses (def. 11): un precio del catálogo por proveedor se da
 *     por válido si su `fecha_precio` tiene menos de N meses; si no, se busca.
 *   - vigencia_web_meses (def. 4): un precio guardado de una búsqueda web previa se
 *     reutiliza si su `fecha_busqueda` tiene menos de N meses; si no, se vuelve a buscar.
 *
 * Los valores se cachean en memoria (proceso único PM2) y se refrescan al guardar
 * desde el endpoint de configuración. Si la tabla aún no existe (antes de migrar),
 * se usan los valores por defecto (o las variables de entorno) sin romper nada.
 */
const { pool } = require('./db');

const DEFAULTS = {
  vigencia_catalogo_meses: Math.max(1, parseInt(process.env.PRECIO_VIGENCIA_MESES, 10) || 11),
  vigencia_web_meses:      Math.max(1, parseInt(process.env.PRECIO_VIGENCIA_WEB_MESES, 10) || 4),
};
const CLAVES = Object.keys(DEFAULTS);

let cache = { ...DEFAULTS };
let cargado = false;

/** Carga (o recarga) los valores desde la tabla `configuracion`. */
async function cargar() {
  try {
    const [rows] = await pool.query(
      'SELECT clave, valor FROM configuracion WHERE clave IN (?)', [CLAVES]
    );
    for (const r of rows) {
      const n = parseInt(r.valor, 10);
      if (Number.isInteger(n) && n > 0) cache[r.clave] = n;
    }
  } catch (e) {
    // Tabla aún no migrada u otro problema: se mantienen los defaults.
  }
  cargado = true;
  return { ...cache };
}

/** Devuelve las ventanas vigentes (carga perezosa la primera vez). */
async function getVigencias() {
  if (!cargado) await cargar();
  return { ...cache };
}

/** Actualiza la copia en memoria tras un guardado (evita releer la BD). */
function aplicar(obj) {
  for (const k of CLAVES) {
    if (obj[k] != null) {
      const n = parseInt(obj[k], 10);
      if (Number.isInteger(n) && n > 0) cache[k] = n;
    }
  }
  return { ...cache };
}

module.exports = { getVigencias, cargar, aplicar, DEFAULTS, CLAVES };
