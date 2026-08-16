/**
 * escapeHtml — Los generadores de PDF (Puppeteer) arman HTML por
 * interpolación de strings y luego lo renderizan con
 * `waitUntil: 'networkidle0'`, que sí ejecuta requests de red embebidos
 * (ej. `<img src="http://ip-interna/...">`). Sin escapar, un campo de
 * texto capturado del usuario (descripción, nombre, indicaciones médicas)
 * puede inyectar markup y disparar SSRF ciego desde el servidor. Envolver
 * todo campo de datos con esc() antes de interpolarlo en el HTML.
 */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { esc };
