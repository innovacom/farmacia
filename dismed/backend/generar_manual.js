/**
 * generar_manual.js — Genera el Manual de Usuario para compartir, a partir de la
 * MISMA fuente que la Ayuda dentro del sistema (frontend/src/pages/Ayuda/manual.json).
 * Produce:
 *   - MANUAL_USUARIO.html  (se abre en navegador y en Word; fácil de compartir)
 *   - MANUAL_USUARIO.pdf   (para enviar por correo)
 * Uso:  node generar_manual.js
 */
const fs = require('fs');
const path = require('path');

const TEAL = '#00ACC1';
const manualPath = path.resolve(__dirname, '../frontend/src/pages/Ayuda/manual.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const outDir = path.resolve(__dirname, '..'); // raíz "sistema cotizaciones"

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Incrusta la captura como data URL (base64) para que el HTML/PDF sea autocontenido.
function imagenHtml(rel) {
  if (!rel) return '';
  try {
    const file = path.resolve(__dirname, '../frontend/public', rel.replace(/^\//, ''));
    const b64 = fs.readFileSync(file).toString('base64');
    return `<img class="shot" src="data:image/png;base64,${b64}" alt="">`;
  } catch (_) { return ''; }
}

function seccionHtml(s) {
  const pasos = (s.pasos || []).length
    ? `<ol>${s.pasos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : '';
  const tips = (s.tips || []).map((t) =>
    `<p class="tip"><span>Tip:</span> ${esc(t)}</p>`).join('');
  const intro = s.intro ? `<p class="intro">${esc(s.intro)}</p>` : '';
  return `<section><h2>${esc(s.titulo)}</h2>${intro}${imagenHtml(s.imagen)}${pasos}${tips}</section>`;
}

const indice = manual.secciones
  .map((s) => `<li>${esc(s.titulo)}</li>`).join('');

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${esc(manual.titulo)} — ${esc(manual.subtitulo)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#222;max-width:820px;margin:0 auto;padding:32px 28px;line-height:1.5}
  h1{color:${TEAL};font-size:26px;margin:0 0 2px}
  .sub{color:#555;font-size:13px;margin:0 0 18px}
  .lead{background:#e8f7fa;border-left:4px solid ${TEAL};padding:10px 14px;border-radius:6px;font-size:13px;margin:0 0 20px}
  h2{color:#0b6b78;font-size:16px;margin:22px 0 6px;border-bottom:1px solid #e3e3e3;padding-bottom:4px}
  .intro{font-size:13px;color:#444;margin:0 0 8px}
  ol{font-size:13px;margin:6px 0 6px 4px;padding-left:20px}
  ol li{margin:3px 0}
  .tip{font-size:12px;color:#666;margin:3px 0;background:#fafafa;border:1px solid #eee;border-radius:4px;padding:5px 8px}
  .tip span{color:${TEAL};font-weight:bold}
  .shot{display:block;width:100%;max-width:680px;border:1px solid #ddd;border-radius:6px;margin:8px 0 10px}
  .toc{border:1px solid #e3e3e3;border-radius:8px;padding:10px 16px;margin-bottom:8px;background:#fbfbfb}
  .toc p{font-weight:bold;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin:0 0 6px}
  .toc ol{columns:2;font-size:12px}
  footer{margin-top:26px;text-align:center;color:#999;font-size:11px;border-top:1px solid #eee;padding-top:10px}
  @media print{body{padding:0}section,li{page-break-inside:avoid}}
</style></head><body>
  <h1>${esc(manual.titulo)}</h1>
  <p class="sub">${esc(manual.subtitulo)}</p>
  <div class="lead">${esc(manual.intro)}</div>
  <div class="toc"><p>Contenido</p><ol>${indice}</ol></div>
  ${manual.secciones.map(seccionHtml).join('')}
  <footer>${esc(manual.subtitulo)} · Manual de usuario · Generado ${new Date().toLocaleDateString('es-MX')}</footer>
</body></html>`;

const htmlPath = path.join(outDir, 'MANUAL_USUARIO.html');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('HTML:', htmlPath);

(async () => {
  try {
    const puppeteer = require('puppeteer');
    const launchOptions = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    };
    if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfPath = path.join(outDir, 'MANUAL_USUARIO.pdf');
    await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' } });
    await browser.close();
    console.log('PDF :', pdfPath);
  } catch (e) {
    console.log('PDF no generado (', e.message, ') — el HTML sí quedó y se puede abrir/imprimir en Word o navegador.');
  }
  process.exit(0);
})();
