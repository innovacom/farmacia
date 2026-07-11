/**
 * sat.fiel.js — Carga la e.firma (FIEL) usada para autenticarse ante el
 * servicio de Descarga Masiva del SAT.
 *
 * Ubicación de los archivos (configurable con SAT_FIEL_DIR):
 *   <dir>/*.cer                  certificado de la FIEL (DER, como lo da el SAT)
 *   <dir>/*.key                  llave privada de la FIEL (DER)
 *   <dir>/clave sat.txt          contraseña de la llave (o env SAT_FIEL_PASSWORD)
 *
 * Por defecto apunta a la carpeta cfdi/efirma de la raíz del proyecto (dev).
 * En el VPS debe definirse SAT_FIEL_DIR a la ruta donde se desplieguen los
 * archivos de la e.firma.
 */
const fs = require('fs');
const path = require('path');

function fielDir() {
  if (process.env.SAT_FIEL_DIR) return path.resolve(process.env.SAT_FIEL_DIR);
  // dev: <repo>/cfdi/efirma  (backend está en <repo>/dismed/backend)
  return path.resolve(__dirname, '../../../../../cfdi/efirma');
}

function findByExt(dir, ext) {
  const f = fs.readdirSync(dir).find((n) => n.toLowerCase().endsWith(ext));
  if (!f) throw new Error(`No se encontró archivo ${ext} en ${dir}`);
  return path.join(dir, f);
}

function readPassword(dir) {
  if (process.env.SAT_FIEL_PASSWORD) return process.env.SAT_FIEL_PASSWORD;
  const candidates = ['clave sat.txt', 'clave_sat.txt', 'clavesat.txt', 'password.txt'];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  }
  throw new Error(`No se encontró la contraseña de la FIEL (clave sat.txt) en ${dir}`);
}

/** Devuelve { cerBinary, keyBinary, password } listos para Fiel.create(). */
function cargarFiel() {
  const dir = fielDir();
  if (!fs.existsSync(dir)) throw new Error(`Carpeta de e.firma no existe: ${dir}`);
  return {
    dir,
    cerBinary: fs.readFileSync(findByExt(dir, '.cer'), 'binary'),
    keyBinary: fs.readFileSync(findByExt(dir, '.key'), 'binary'),
    password: readPassword(dir),
  };
}

module.exports = { cargarFiel, fielDir };
