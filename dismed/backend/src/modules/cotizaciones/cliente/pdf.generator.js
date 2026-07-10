const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const TEAL = '#00ACC1';

async function generarPdfCotizacion(cotizacion) {
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './outputs');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const filename = `${cotizacion.folio}-${Date.now()}.pdf`;
  const filePath = path.join(outputDir, filename);
  const html = buildHtml(cotizacion);

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
      margin: { top: '5mm', bottom: '18mm', left: '10mm', right: '10mm' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: buildFooterTemplate(),
    });
  } finally {
    await browser.close();
  }

  return { filePath, filename, relativePath: `/outputs/${filename}` };
}

function buildFooterTemplate() {
  const web   = process.env.EMPRESA_WEB      || 'www.innovacom.mx';
  const email = process.env.EMPRESA_EMAIL    || 'ventas@innovacom.mx';
  const tel   = process.env.EMPRESA_TELEFONO || '';
  return `
    <div style="font-family:Arial,sans-serif;font-size:8.5px;color:#444;width:100%;
                padding:3px 10mm 0;box-sizing:border-box;
                display:flex;justify-content:space-between;align-items:center;
                border-top:1px solid #ccc;">
      <span>visita nuestra pagina : ${web} &nbsp;&nbsp; correo: ${email} &nbsp;&nbsp; ${tel}</span>
      <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
    </div>`;
}

function getLogoBase64() {
  try {
    const p = path.join(__dirname, '../../../assets/logo_innovacom.jpg');
    if (fs.existsSync(p)) return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
  } catch (_) {}
  return null;
}

function buildHtml(cot) {
  const empresa = {
    nombre:    process.env.EMPRESA_NOMBRE    || 'INNOVACOM',
    rfc:       process.env.EMPRESA_RFC       || '',
    telefono:  process.env.EMPRESA_TELEFONO  || '',
    email:     process.env.EMPRESA_EMAIL     || '',
    direccion: process.env.EMPRESA_DIRECCION || '',
  };

  const logoSrc = getLogoBase64();
  const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const now = new Date();
  const fechaStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
  const vigDate = new Date();
  vigDate.setDate(vigDate.getDate() + (cot.dias_vigencia || 30));
  const vigenciaStr = vigDate.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + vigDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });

  // Folio display: strip "COT-" prefix for the large number
  const folioDisplay = (cot.folio || '').replace(/^COT-/, '');

  // ── Filas de partidas ──────────────────────────────────────────
  let totalSubtotal = 0, totalIva = 0;
  const filas = (cot.partidas || []).map((p, i) => {
    const ivaPct   = p.iva_exento ? 0 : 0.16;
    const subtotal = Number(p.precio_unitario_venta || 0) * Number(p.cantidad || 0);
    const ivaLinea = subtotal * ivaPct;
    const total    = subtotal + ivaLinea;
    totalSubtotal += subtotal;
    totalIva      += ivaLinea;

    const descExtra = [
      p.codigo_cliente ? `<span class="sku">Ref: ${p.codigo_cliente}</span>` : '',
      p.sku_interno    ? `<span class="sku"> | SKU: ${p.sku_interno}</span>` : '',
    ].filter(Boolean).join('');

    return `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#f0fbfd'}">
        <td class="c num">${i + 1}</td>
        <td class="c">${Number(p.cantidad).toLocaleString('es-MX')}</td>
        <td class="c unit">${p.unidad_medida || 'pieza'}</td>
        <td class="desc">${p.descripcion || ''}${descExtra ? `<br>${descExtra}` : ''}</td>
        <td class="r">${fmt(p.precio_unitario_venta)}</td>
        <td class="r">${subtotal ? fmt(subtotal) : '$0.00'}</td>
        <td class="r">${ivaLinea ? fmt(ivaLinea) : '$0.00'}</td>
        <td class="r bold">${total ? fmt(total) : '$0.00'}</td>
        <td class="obs">${p.observaciones || ''}</td>
      </tr>`;
  }).join('');
  const totalFinal = totalSubtotal + totalIva;

  // ── HTML del encabezado repetido en thead ──────────────────────
  const theadHtml = `
    <!-- Banda turquesa: empresa + folio + campos cliente -->
    <tr>
      <td colspan="9" style="padding:0;background:${TEAL}">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <!-- Logo + datos empresa -->
            <td style="padding:8px 10px;vertical-align:middle;width:32%">
              ${logoSrc ? `<img src="${logoSrc}" style="height:70px;object-fit:contain;display:block;margin-bottom:3px"/>` : ''}
              <div style="font-size:10.5px;font-weight:bold;color:#fff;margin-bottom:1px">${empresa.nombre}</div>
              <div style="font-size:8px;color:#e0f7fa;line-height:1.5">${empresa.direccion}</div>
              <div style="font-size:8px;color:#e0f7fa">RFC: ${empresa.rfc}</div>
            </td>
            <!-- Campos: fecha, cliente, atención, concepto -->
            <td style="padding:8px 6px;vertical-align:middle;width:40%">
              <table style="border-collapse:collapse;font-size:9.5px;width:100%">
                <tr>
                  <td style="color:#b2ebf2;padding:1px 5px 1px 0;white-space:nowrap">fecha</td>
                  <td style="color:#fff;font-weight:bold">${fechaStr}</td>
                </tr>
                <tr>
                  <td style="color:#b2ebf2;padding:2px 5px 1px 0;white-space:nowrap">Cliente</td>
                  <td style="color:#fff;font-weight:bold;font-style:italic">${cot.cliente_razon_social || ''}</td>
                </tr>
                <tr>
                  <td style="color:#b2ebf2;padding:1px 5px 1px 0;white-space:nowrap">Atención</td>
                  <td style="color:#fff;font-weight:bold;font-style:italic">${cot.atencion || cot.contacto_nombre || ''}</td>
                </tr>
                <tr>
                  <td style="color:#b2ebf2;padding:1px 5px 1px 0;white-space:nowrap">Concepto</td>
                  <td style="color:#fff">${cot.concepto || ''}</td>
                </tr>
              </table>
            </td>
            <!-- Folio grande + COC -->
            <td style="padding:8px 12px 8px 6px;vertical-align:middle;text-align:right;width:28%">
              <div style="font-size:9px;color:#b2ebf2;margin-bottom:2px">cotizacion</div>
              <div style="font-size:34px;font-weight:bold;color:#fff;line-height:1;letter-spacing:-1px">${folioDisplay}</div>
              <div style="margin-top:8px;font-size:10px">
                <span style="color:#b2ebf2">No. Solicitud Cliente &nbsp;</span>
                <span style="color:#fff;font-weight:bold">${cot.coc || cot.referencia_cliente || ''}</span>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <!-- Encabezados de columnas -->
    <tr style="background:${TEAL}">
      <th class="th c" style="width:2.5%">#</th>
      <th class="th c" style="width:5.5%">CANTIDAD</th>
      <th class="th c" style="width:8%">UNIDAD</th>
      <th class="th" style="width:33%;text-align:left">DESCRIPCION</th>
      <th class="th r" style="width:10%">PRECIO UNITARIO</th>
      <th class="th r" style="width:10%">SUBTOTAL</th>
      <th class="th r" style="width:9%">IVA</th>
      <th class="th r" style="width:10%">TOTAL</th>
      <th class="th" style="width:12%;text-align:left">OBSERVACION</th>
    </tr>`;

  // ── Sección final: totales + nota + firmas ─────────────────────
  const notaVigencia = cot.nota_vigencia ||
    'Esta cotizacion es valida hasta la fecha indicada, en caso de contar con su preferencia, ' +
    'la entrega de mercancía se realiza en 5 días hábiles, a menos que exista desabasto del ' +
    'producto o esté indicado otro tiempo en las observaciones.';

  const finalSection = `
    <div style="margin:8px 0 0">
      <!-- Totales globales -->
      <table style="margin-left:auto;width:230px;border-collapse:collapse;font-size:11px">
        <tr>
          <td style="padding:3px 8px;color:#555">SUBTOTAL</td>
          <td style="padding:3px 8px;text-align:right">${fmt(totalSubtotal)}</td>
        </tr>
        <tr>
          <td style="padding:3px 8px;color:#555">IVA</td>
          <td style="padding:3px 8px;text-align:right">${fmt(totalIva)}</td>
        </tr>
        <tr style="border-top:2px solid ${TEAL};font-weight:bold;font-size:13px;color:${TEAL}">
          <td style="padding:4px 8px">TOTAL</td>
          <td style="padding:4px 8px;text-align:right">${fmt(totalFinal)}</td>
        </tr>
      </table>

      <!-- Nota vigencia -->
      <p style="font-size:8.5px;color:#333;margin-top:10px;font-weight:bold;line-height:1.5">
        ${notaVigencia}
      </p>

      <!-- Firmas -->
      <table style="width:100%;border-collapse:collapse;font-size:9px;color:#333;margin-top:14px">
        <tr>
          <td style="width:22%;padding:4px;vertical-align:top">
            <div style="color:#666;text-decoration:underline">vigencia</div>
            <div style="margin-top:3px">${vigenciaStr}</div>
          </td>
          <td style="width:26%;padding:4px;vertical-align:top">
            <div style="color:#666;text-decoration:underline">elabora</div>
            <div style="margin-top:3px;font-weight:bold">${cot.elaboro_nombre || ''}</div>
          </td>
          <td style="width:26%;padding:4px;vertical-align:top">
            <div style="color:#666;text-decoration:underline">autoriza</div>
            <div style="margin-top:3px;font-weight:bold">${cot.autoriza_nombre || empresa.nombre}</div>
          </td>
          <td style="width:26%;padding:4px;vertical-align:top;text-align:right">
            <div style="color:#666;font-style:italic">representante legal</div>
            <div style="margin-top:3px;font-weight:bold">${cot.representante_legal || ''}</div>
          </td>
        </tr>
      </table>
      <div style="font-size:8.5px;color:#444;margin-top:10px">
        Para cualquier duda con esta cotizacion contacte a
        <strong>${cot.contacto_dudas_email || empresa.email}</strong>
        ó al <strong>${cot.contacto_dudas_tel || empresa.telefono}</strong>
      </div>
    </div>`;

  // ── HTML completo ──────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9.5px; color: #222; }
  table.main { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  .th {
    padding: 5px 4px;
    font-size: 8.5px;
    font-style: italic;
    font-weight: bold;
    color: #fff;
    text-align: center;
  }
  td { padding: 4px; vertical-align: top; border-bottom: 1px solid #e8f0f0; font-size: 9px; }
  .c    { text-align: center; }
  .r    { text-align: right; white-space: nowrap; }
  .num  { width: 20px; color: #888; }
  .unit { font-size: 8px; color: #555; }
  .desc { line-height: 1.4; }
  .obs  { font-size: 8px; color: #555; }
  .sku  { color: #999; font-size: 8px; }
  .bold { font-weight: bold; }
</style>
</head>
<body>

<table class="main">
  <thead>${theadHtml}</thead>
  <tbody>${filas}</tbody>
</table>

${finalSection}

</body>
</html>`;
}

module.exports = { generarPdfCotizacion };
