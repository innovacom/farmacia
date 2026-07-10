const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const TEAL = '#00ACC1';
const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function empresa() {
  return {
    nombre:    process.env.EMPRESA_NOMBRE    || 'INNOVACOM',
    rfc:       process.env.EMPRESA_RFC       || '',
    telefono:  process.env.EMPRESA_TELEFONO  || '',
    email:     process.env.EMPRESA_EMAIL     || '',
    direccion: process.env.EMPRESA_DIRECCION || '',
  };
}
function logoBase64() {
  try {
    const p = path.join(__dirname, '../../assets/logo_innovacom.jpg');
    if (fs.existsSync(p)) return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
  } catch (_) {}
  return null;
}

async function renderPdf(html, folio) {
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './outputs');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filename = `${folio}-${Date.now()}.pdf`;
  const filePath = path.join(outputDir, filename);
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote'],
  };
  if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: filePath, format: 'Letter', printBackground: true,
      margin: { top: '6mm', bottom: '14mm', left: '10mm', right: '10mm' } });
  } finally { await browser.close(); }
  return { filePath, filename, relativePath: `/outputs/${filename}` };
}

function encabezado(e, logo, titulo, folio) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${TEAL};padding-bottom:8px;margin-bottom:12px">
      <div style="display:flex;gap:10px;align-items:center">
        ${logo ? `<img src="${logo}" style="height:54px">` : ''}
        <div>
          <div style="font-size:18px;font-weight:bold;color:${TEAL}">${e.nombre}</div>
          <div style="font-size:9px;color:#555">${e.rfc ? 'RFC: ' + e.rfc : ''}</div>
          <div style="font-size:9px;color:#555">${e.direccion || ''}</div>
          <div style="font-size:9px;color:#555">${e.telefono || ''} ${e.email ? ' · ' + e.email : ''}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15px;font-weight:bold;color:#333">${titulo}</div>
        <div style="font-size:20px;font-weight:bold;color:${TEAL}">${folio}</div>
        <div style="font-size:9px;color:#555">${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
      </div>
    </div>`;
}

function tablaBase() {
  return `width:100%;border-collapse:collapse;font-size:10px`;
}
const th = `background:${TEAL};color:#fff;padding:5px 6px;text-align:left;font-size:9.5px`;
const td = `padding:4px 6px;border-bottom:1px solid #eee`;

// ── Orden de compra ───────────────────────────────────────────────────────────
function buildOcHtml(oc) {
  const e = empresa(); const logo = logoBase64();
  let total = 0;
  // Mostrar la columna del código del proveedor solo si alguna partida lo trae
  const conSkuProv = (oc.partidas || []).some((p) => p.sku_proveedor);
  const filas = (oc.partidas || []).map((p) => {
    const importe = Number(p.precio_compra) * Number(p.cantidad);
    total += importe;
    return `<tr>
      <td style="${td};font-family:monospace">${p.sku_interno || ''}</td>
      ${conSkuProv ? `<td style="${td};font-family:monospace">${p.sku_proveedor || ''}</td>` : ''}
      <td style="${td}">${p.descripcion || ''}</td>
      <td style="${td};text-align:right">${Number(p.cantidad).toLocaleString('es-MX')}</td>
      <td style="${td}">${p.unidad_medida || ''}</td>
      <td style="${td};text-align:right">${fmt(p.precio_compra)}</td>
      <td style="${td};text-align:right">${fmt(importe)}</td></tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:#222;margin:0}</style></head><body>
    ${encabezado(e, logo, 'ORDEN DE COMPRA', oc.folio)}
    <div style="background:#f6f9fa;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:10px">
      <strong>Proveedor:</strong> ${oc.proveedor_nombre || ''} &nbsp;&nbsp; ${oc.pedido_folio ? `<strong>Pedido:</strong> ${oc.pedido_folio}` : ''}
    </div>
    <table style="${tablaBase()}">
      <thead><tr><th style="${th}">SKU</th>${conSkuProv ? `<th style="${th}">SKU Prov.</th>` : ''}<th style="${th}">Descripción</th><th style="${th};text-align:right">Cant.</th><th style="${th}">U/M</th><th style="${th};text-align:right">P. Compra</th><th style="${th};text-align:right">Importe</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <table style="font-size:12px"><tr><td style="padding:4px 12px;font-weight:bold">TOTAL</td><td style="padding:4px 12px;text-align:right;font-weight:bold;color:${TEAL}">${fmt(total)}</td></tr></table>
    </div>
    ${oc.notas ? `<p style="font-size:9px;color:#555;margin-top:10px">${oc.notas}</p>` : ''}
  </body></html>`;
}

// ── Remisión / Factura ────────────────────────────────────────────────────────
function buildEntregaHtml(ent) {
  const e = empresa(); const logo = logoBase64();
  const titulo = ent.tipo === 'factura' ? 'FACTURA' : 'REMISIÓN';
  let subtotal = 0, iva = 0;
  const filas = (ent.partidas || []).map((p) => {
    const imp = Number(p.precio_unitario) * Number(p.cantidad);
    const ivaL = p.iva_exento ? 0 : imp * 0.16;
    subtotal += imp; iva += ivaL;
    return `<tr>
      <td style="${td};font-family:monospace">${p.sku_interno || ''}</td>
      <td style="${td}">${p.descripcion || ''}</td>
      <td style="${td};text-align:right">${Number(p.cantidad).toLocaleString('es-MX')}</td>
      <td style="${td}">${p.unidad_medida || ''}</td>
      <td style="${td};text-align:right">${fmt(p.precio_unitario)}</td>
      <td style="${td};text-align:right">${fmt(imp)}</td></tr>`;
  }).join('');
  const total = subtotal + iva;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:#222;margin:0}</style></head><body>
    ${encabezado(e, logo, titulo, ent.folio)}
    <div style="background:#f6f9fa;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:10px">
      <strong>Cliente:</strong> ${ent.cliente_nombre || ''} &nbsp;&nbsp; ${ent.pedido_folio ? `<strong>Pedido:</strong> ${ent.pedido_folio}` : ''}
    </div>
    <table style="${tablaBase()}">
      <thead><tr><th style="${th}">SKU</th><th style="${th}">Descripción</th><th style="${th};text-align:right">Cant.</th><th style="${th}">U/M</th><th style="${th};text-align:right">P. Unitario</th><th style="${th};text-align:right">Importe</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <table style="font-size:11px">
        <tr><td style="padding:3px 12px;color:#555">Subtotal</td><td style="padding:3px 12px;text-align:right">${fmt(subtotal)}</td></tr>
        <tr><td style="padding:3px 12px;color:#555">IVA</td><td style="padding:3px 12px;text-align:right">${fmt(iva)}</td></tr>
        <tr style="font-weight:bold;color:${TEAL};font-size:13px"><td style="padding:4px 12px">TOTAL</td><td style="padding:4px 12px;text-align:right">${fmt(total)}</td></tr>
      </table>
    </div>
    ${ent.tipo !== 'factura' ? '<p style="font-size:8.5px;color:#999;margin-top:14px">Documento de remisión sin validez fiscal.</p>' : ''}
  </body></html>`;
}

// ── Bloque fiscal CFDI (representación impresa de un CFDI 4.0 timbrado) ─────────
function buildCfdiBlock(cfdi) {
  const sello = `font-family:'Courier New',monospace;font-size:7px;color:#333;word-break:break-all;line-height:1.25`;
  const lbl = `font-size:7.5px;color:#777;margin-top:4px`;
  const val = `font-size:8px;color:#222`;
  const fechaTimbrado = cfdi.fecha_timbrado
    ? new Date(cfdi.fecha_timbrado).toLocaleString('es-MX')
    : '';
  return `
    <div style="margin-top:16px;border-top:1px solid #ccc;padding-top:8px">
      <div style="font-size:8.5px;font-weight:bold;color:${TEAL};margin-bottom:4px">
        Este documento es una representación impresa de un CFDI 4.0
      </div>
      <div style="font-size:8px;color:#444;margin-bottom:6px">
        <strong>Emisor:</strong> ${cfdi.emisor_nombre || ''} ${cfdi.emisor_rfc ? '· RFC ' + cfdi.emisor_rfc : ''}
      </div>
      <div style="display:flex;gap:12px;align-items:flex-start">
        <div style="flex:0 0 90px;text-align:center">
          ${cfdi.qr_dataurl ? `<img src="${cfdi.qr_dataurl}" style="width:90px;height:90px">` : ''}
        </div>
        <div style="flex:1">
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div><div style="${lbl}">Folio Fiscal (UUID)</div><div style="${val}">${cfdi.uuid || ''}</div></div>
            <div><div style="${lbl}">No. Serie Cert. Emisor</div><div style="${val}">${cfdi.cert_emisor || ''}</div></div>
            <div><div style="${lbl}">No. Serie Cert. SAT</div><div style="${val}">${cfdi.cert_sat || ''}</div></div>
            <div><div style="${lbl}">Fecha y hora de certificación</div><div style="${val}">${fechaTimbrado}</div></div>
            <div><div style="${lbl}">RFC del PAC</div><div style="${val}">${cfdi.rfc_prov_certif || ''}</div></div>
          </div>
          <div style="${lbl}">Sello Digital del CFDI</div>
          <div style="${sello}">${cfdi.sello_cfdi || ''}</div>
          <div style="${lbl}">Sello del SAT</div>
          <div style="${sello}">${cfdi.sello_sat || ''}</div>
          <div style="${lbl}">Cadena Original del Complemento de Certificación del SAT</div>
          <div style="${sello}">${cfdi.cadena_original_tfd || ''}</div>
        </div>
      </div>
    </div>`;
}

// Inserta el bloque fiscal antes de cerrar el body de la remisión/factura.
function buildFacturaCfdiHtml(ent, cfdi) {
  const html = buildEntregaHtml(ent);
  return html.replace('</body></html>', `${buildCfdiBlock(cfdi)}</body></html>`);
}

async function generarOcPdf(oc)      { return renderPdf(buildOcHtml(oc), oc.folio); }
async function generarEntregaPdf(ent) { return renderPdf(buildEntregaHtml(ent), ent.folio); }
// PDF de la factura timbrada (CFDI). Usa un folio distinto para no pisar la remisión.
async function generarFacturaCfdiPdf(ent, cfdi) {
  return renderPdf(buildFacturaCfdiHtml(ent, cfdi), `${ent.folio}-CFDI`);
}

module.exports = { generarOcPdf, generarEntregaPdf, generarFacturaCfdiPdf, buildFacturaCfdiHtml };
