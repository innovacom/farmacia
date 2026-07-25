const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Receta electrónica en media carta, 2 copias en una hoja carta (paciente +
// farmacia) — la copia de farmacia se retiene al surtir antibióticos o
// controlados, según exige la legislación (LGS art. 226 / COFEPRIS).
async function generarPdfReceta(receta) {
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './outputs');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const filename = `${receta.folio}-${Date.now()}.pdf`;
  const filePath = path.join(outputDir, filename);
  const html = buildHtml(receta);

  const launchArgs = [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--no-zygote',
  ];
  const launchOptions = { headless: 'new', args: launchArgs };
  if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: filePath,
      format: 'Letter',
      margin: { top: '6mm', bottom: '6mm', left: '8mm', right: '8mm' },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }

  return { filePath, filename, relativePath: `/outputs/${filename}` };
}

function getCaduceoBase64() {
  try {
    const p = path.join(__dirname, '../../assets/caduceo.png');
    if (fs.existsSync(p)) return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
  } catch (_) {}
  return null;
}

function edad(fechaNacimiento) {
  if (!fechaNacimiento) return '';
  const hoy = new Date();
  const nac = new Date(fechaNacimiento);
  let a = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) a--;
  return a;
}

function buildHtml(r) {
  const caduceoSrc = getCaduceoBase64();
  const pacienteNombre = [r.paciente_nombre, r.paciente_apellido_paterno, r.paciente_apellido_materno]
    .filter(Boolean).join(' ');
  const edadStr = edad(r.paciente_fecha_nacimiento);
  const fechaStr = new Date(r.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

  let signos = {};
  try { signos = typeof r.signos_vitales === 'string' ? JSON.parse(r.signos_vitales) : (r.signos_vitales || {}); }
  catch (_) { signos = {}; }

  const partidasHtml = (r.partidas || []).map((p, i) => `
    <div class="rx-item">
      <span class="rx-num">${i + 1}.</span>
      <strong>${p.medicamento_nombre}</strong>${p.presentacion ? ` — ${p.presentacion}` : ''}
      <span class="rx-cant">Cant: ${Number(p.cantidad)}</span>
      <div class="rx-detalle">
        ${[p.dosis, p.via_administracion, p.frecuencia, p.duracion].filter(Boolean).join(' · ')}
        ${p.indicaciones ? `<br/>${p.indicaciones}` : ''}
      </div>
    </div>`).join('');

  function copia(etiqueta) {
    return `
    <div class="copia">
      <div class="encabezado">
        <div class="folio">FOLIO:${r.folio}</div>
        <div class="titulo">
          ${caduceoSrc ? `<img src="${caduceoSrc}" class="caduceo"/>` : ''}
          ${r.medico_institucion ? `<div class="institucion">${r.medico_institucion}</div>` : ''}
          ${r.medico_especialidad ? `<div class="especialidad">${r.medico_especialidad}</div>` : ''}
          <div class="medico-nombre">Dr. ${r.medico_nombre}</div>
        </div>
        <div class="vitales">
          ${signos.peso ? `<div>PESO: ${signos.peso}</div>` : ''}
          ${signos.talla ? `<div>TALLA: ${signos.talla}</div>` : ''}
          ${signos.temp ? `<div>TEMP: ${signos.temp}</div>` : ''}
          ${signos.ta ? `<div>T.A.: ${signos.ta}</div>` : ''}
          ${signos.fc ? `<div>FC: ${signos.fc}</div>` : ''}
          ${signos.fr ? `<div>FR: ${signos.fr}</div>` : ''}
        </div>
      </div>

      <div class="paciente-linea">
        <span>PACIENTE: <strong>${pacienteNombre}</strong></span>
        <span>EDAD: <strong>${edadStr}</strong></span>
        <span>FECHA: <strong>${fechaStr}</strong></span>
      </div>

      <div class="rx-titulo">Rx</div>
      <div class="rx-body">
        ${partidasHtml}
        ${r.indicaciones_generales ? `<div class="indicaciones-generales"><strong>Indicaciones generales:</strong> ${r.indicaciones_generales}</div>` : ''}
      </div>

      <div class="pie">
        <div class="pie-izq">
          ${r.sucursal_direccion ? `<div>${r.sucursal_direccion}</div>` : ''}
          ${r.medico_telefono ? `<div>CEL. ${r.medico_telefono}</div>` : ''}
        </div>
        <div class="pie-der">
          <div>Céd. Prof. ${r.medico_cedula || ''}</div>
          ${r.medico_registro_ssa ? `<div>S.S.A. ${r.medico_registro_ssa}</div>` : ''}
          <div class="vigencia">Vigencia: ${r.vigencia_dias || 30} días</div>
        </div>
      </div>

      <div class="etiqueta-copia">${etiqueta}</div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #222; }
  .copia {
    height: 128mm;
    padding: 4mm 2mm;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .copia + .copia { border-top: 1px dashed #999; }
  .encabezado { display: flex; align-items: flex-start; justify-content: space-between; }
  .folio { color: #EE0000; font-weight: bold; font-size: 11px; width: 20%; }
  .titulo { text-align: center; width: 60%; }
  .caduceo { height: 26px; margin-bottom: 2px; }
  .institucion { font-weight: bold; font-size: 14px; }
  .especialidad { font-weight: bold; font-size: 11px; }
  .medico-nombre { font-weight: bold; font-size: 20px; color: #156082; margin-top: 2px; }
  .vitales { width: 20%; font-size: 8.5px; text-align: right; line-height: 1.5; color: #333; }
  .paciente-linea {
    margin-top: 6mm; padding-bottom: 2mm; border-bottom: 1px solid #999;
    display: flex; justify-content: space-between; font-size: 10px;
  }
  .rx-titulo { font-size: 22px; font-weight: bold; font-style: italic; color: #156082; margin-top: 4mm; }
  .rx-body { flex: 1; margin-top: 2mm; font-size: 10px; }
  .rx-item { margin-bottom: 2.5mm; }
  .rx-num { color: #666; margin-right: 2px; }
  .rx-cant { float: right; color: #555; font-size: 9px; }
  .rx-detalle { font-size: 9px; color: #444; margin-left: 12px; }
  .indicaciones-generales { margin-top: 3mm; font-size: 9.5px; }
  .pie {
    margin-top: 2mm; padding-top: 2mm; border-top: 1px solid #ccc;
    display: flex; justify-content: space-between; font-size: 9px; color: #333;
  }
  .pie-der { text-align: right; font-weight: bold; }
  .vigencia { font-weight: normal; color: #666; }
  .etiqueta-copia {
    position: absolute; bottom: 1mm; right: 2mm;
    font-size: 7.5px; color: #aaa; text-transform: uppercase;
  }
</style>
</head>
<body>
${copia('Copia paciente')}
${copia('Copia farmacia')}
</body>
</html>`;
}

module.exports = { generarPdfReceta };
