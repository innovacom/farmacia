const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { esc } = require('../../utils/html');
const { importeEnLetra } = require('../../utils/importeLetra');

const TEAL = '#00ACC1';
const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function empresa() {
  return {
    nombre:      process.env.EMPRESA_NOMBRE        || 'INNOVACOM',
    razonSocial: process.env.EMPRESA_RAZON_SOCIAL  || process.env.EMPRESA_NOMBRE || '',
    rfc:         process.env.EMPRESA_RFC           || '',
    regimen:     process.env.EMPRESA_REGIMEN_FISCAL || '',
    cp:          process.env.EMPRESA_CP            || '',
    telefono:    process.env.EMPRESA_TELEFONO      || '',
    email:       process.env.EMPRESA_EMAIL         || '',
    direccion:   process.env.EMPRESA_DIRECCION     || '',
  };
}

// Catálogos SAT (sólo las etiquetas que se usan en la representación impresa).
const FORMAS_PAGO_SAT = {
  '01': 'Efectivo', '02': 'Cheque nominativo', '03': 'Transferencia electrónica',
  '04': 'Tarjeta de crédito', '05': 'Monedero electrónico', '06': 'Dinero electrónico',
  '08': 'Vales de despensa', '28': 'Tarjeta de débito', '29': 'Tarjeta de servicios',
  '99': 'Por definir',
};
const METODOS_PAGO_SAT = { PUE: 'Pago en una sola exhibición', PPD: 'Pago en parcialidades o diferido' };
const USOS_CFDI_SAT = {
  G01: 'Adquisición de mercancías', G03: 'Gastos en general', I01: 'Construcciones',
  P01: 'Por definir', CP01: 'Pagos', S01: 'Sin efectos fiscales',
};
const REGIMENES_SAT = {
  601: 'General de Ley Personas Morales', 603: 'Personas Morales con Fines no Lucrativos',
  605: 'Sueldos y Salarios e Ingresos Asimilados a Salarios', 606: 'Arrendamiento',
  607: 'Régimen de Enajenación o Adquisición de Bienes', 608: 'Demás ingresos',
  610: 'Residentes en el Extranjero sin Establecimiento Permanente en México',
  611: 'Ingresos por Dividendos (socios y accionistas)',
  612: 'Personas Físicas con Actividades Empresariales y Profesionales',
  614: 'Ingresos por intereses', 615: 'Régimen de los ingresos por obtención de premios',
  616: 'Sin obligaciones fiscales', 620: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos',
  621: 'Incorporación Fiscal', 622: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
  623: 'Opcional para Grupos de Sociedades', 624: 'Coordinados',
  625: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
  626: 'Régimen Simplificado de Confianza',
};
const conCatalogo = (cat, c) => (c ? `${c}${cat[c] ? ' - ' + cat[c] : ''}` : '');
function logoBase64() {
  try {
    const p = path.join(__dirname, '../../assets/logo_innovacom.jpg');
    if (fs.existsSync(p)) return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
  } catch (_) {}
  return null;
}

async function renderPdf(html, folio, footerTemplate = null) {
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
    // El HTML solo usa imágenes data: embebidas — bloquear cualquier otro
    // request evita SSRF si un campo de texto lograra inyectar markup pese
    // al escape (ver utils/html.js).
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().startsWith('data:') ? r.continue() : r.abort()));
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: filePath, format: 'Letter', printBackground: true,
      margin: { top: '6mm', bottom: '14mm', left: '10mm', right: '10mm' },
      ...(footerTemplate ? { displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate } : {}) });
  } finally { await browser.close(); }
  return { filePath, filename, relativePath: `/outputs/${filename}` };
}

function encabezado(e, logo, titulo, folio) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${TEAL};padding-bottom:8px;margin-bottom:12px">
      <div style="display:flex;gap:10px;align-items:center">
        ${logo ? `<img src="${logo}" style="height:54px">` : ''}
        <div>
          <div style="font-size:18px;font-weight:bold;color:${TEAL}">${esc(e.nombre)}</div>
          <div style="font-size:9px;color:#555">${e.rfc ? 'RFC: ' + esc(e.rfc) : ''}</div>
          <div style="font-size:9px;color:#555">${esc(e.direccion)}</div>
          <div style="font-size:9px;color:#555">${esc(e.telefono)} ${e.email ? ' · ' + esc(e.email) : ''}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15px;font-weight:bold;color:#333">${titulo}</div>
        <div style="font-size:20px;font-weight:bold;color:${TEAL}">${esc(folio)}</div>
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
      <td style="${td};font-family:monospace">${esc(p.sku_interno)}</td>
      ${conSkuProv ? `<td style="${td};font-family:monospace">${esc(p.sku_proveedor)}</td>` : ''}
      <td style="${td}">${esc(p.descripcion)}</td>
      <td style="${td};text-align:right">${Number(p.cantidad).toLocaleString('es-MX')}</td>
      <td style="${td}">${esc(p.unidad_medida)}</td>
      <td style="${td};text-align:right">${fmt(p.precio_compra)}</td>
      <td style="${td};text-align:right">${fmt(importe)}</td></tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:#222;margin:0}</style></head><body>
    ${encabezado(e, logo, 'ORDEN DE COMPRA', oc.folio)}
    <div style="background:#f6f9fa;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:10px">
      <strong>Proveedor:</strong> ${esc(oc.proveedor_nombre)} &nbsp;&nbsp; ${oc.pedido_folio ? `<strong>Pedido:</strong> ${esc(oc.pedido_folio)}` : ''}
    </div>
    <table style="${tablaBase()}">
      <thead><tr><th style="${th}">SKU</th>${conSkuProv ? `<th style="${th}">SKU Prov.</th>` : ''}<th style="${th}">Descripción</th><th style="${th};text-align:right">Cant.</th><th style="${th}">U/M</th><th style="${th};text-align:right">P. Compra</th><th style="${th};text-align:right">Importe</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <table style="font-size:12px"><tr><td style="padding:4px 12px;font-weight:bold">TOTAL</td><td style="padding:4px 12px;text-align:right;font-weight:bold;color:${TEAL}">${fmt(total)}</td></tr></table>
    </div>
    ${oc.notas ? `<p style="font-size:9px;color:#555;margin-top:10px">${esc(oc.notas)}</p>` : ''}
  </body></html>`;
}

// ── Remisión ──────────────────────────────────────────────────────────────────
function buildEntregaHtml(ent) {
  return buildFacturaHtml(ent, null, ent.tipo !== 'factura');
}

// ── Factura (representación impresa CFDI 4.0; cfdi = null antes del timbrado) ──
const num = (n) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cantFmt = (n) => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function piezasFmt(n) {
  const v = Number(n);
  return `${Number.isInteger(v) ? v : v.toFixed(2)} ${v === 1 ? 'PIEZA' : 'PIEZAS'}`;
}

function caducidadFmt(f) {
  const d = f ? new Date(f) : null;
  return d && !isNaN(d) ? `${MESES[d.getUTCMonth()]}-${d.getUTCFullYear()}` : '';
}
function fechaIso(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.replace(' ', 'T').slice(0, 19);
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }).replace(' ', 'T');
}

function buildFacturaHtml(ent, cfdi, remision = false) {
  const e = empresa(); const logo = logoBase64();
  const moneda = ent.moneda || 'MXN';
  let subtotal = 0, iva = 0;
  const filas = (ent.partidas || []).map((p) => {
    const cant = Number(p.cantidad || 0);
    const pu = Number(p.precio_unitario || 0);
    const imp = cant * pu;
    const tasa = p.iva_exento ? 0 : 0.16;
    const ivaImp = imp * tasa;
    subtotal += imp; iva += ivaImp;
    const lotes = (p.lotes || [])
      .map((l) => `${l.cantidad ? piezasFmt(l.cantidad) + ' ' : ''}LOTE ${esc(l.lote)}${l.caducidad ? ' CADUCIDAD ' + caducidadFmt(l.caducidad) : ''}`)
      .join(' &nbsp; ');
    return `<tr>
      <td>${esc(p.sku_interno)}</td>
      <td class="r">${cantFmt(cant)}</td>
      <td>${esc(String(p.unidad_medida || '').toUpperCase())}</td>
      <td>${esc(p.descripcion)}${lotes ? `<br>${lotes}` : ''}
        ${remision ? '' : `<br><b>ClaveProdServ:</b> ${esc(p.clave_sat)} <b>ClaveUnidad:</b> ${esc(p.clave_unidad_sat)}
        <div class="imp"><b>Impuesto:</b> IVA Trasladado. <b>Base:</b> ${imp.toFixed(2)} <b>Factor:</b> Tasa ${tasa.toFixed(6)} <b>Importe:</b> ${ivaImp.toFixed(2)}</div>`}</td>
      <td class="r">${num(pu)}</td><td class="r">0.00</td><td class="r">${num(imp)}</td></tr>`;
  }).join('');
  const total = subtotal + iva;

  // Factura timbrada: serie y folio que asignó el PAC (p. ej. G-125); si no los devolvió o es
  // remisión/previo al timbrado, el folio interno.
  const folioPac = [cfdi?.serie, cfdi?.folio].filter(Boolean).join('-');
  const folioMostrado = !remision && folioPac ? folioPac : ent.folio;

  const dirCliente = String(ent.cliente_direccion_fiscal || '');
  const cp = String(ent.cliente_codigo_postal || '');
  const direccionReceptor = `${dirCliente}${cp && !dirCliente.includes(cp) ? ` CP. ${cp}` : ''}`;

  const celda = (lbl, val) => `<div><div><b>${lbl}</b></div><div>${esc(val)}</div></div>`;
  const sello = (titulo, v) => `<div style="flex:1;min-width:0"><div class="bar">${titulo}</div><div class="sello">${esc(v)}</div></div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;color:#222;margin:0;font-size:9px}
    .bar{background:${TEAL};color:#fff;font-weight:bold;text-align:center;padding:6px;font-size:9px;border-radius:8px 8px 0 0}
    .box{background:#eee;padding:8px 10px;line-height:1.8}
    .cell{background:#eee;text-align:center;font-weight:bold;padding:7px;font-size:9px}
    .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 14px;background:#eee;padding:8px 10px;margin-top:4px;line-height:1.7}
    table.p{width:100%;border-collapse:collapse;margin-top:6px;table-layout:fixed}
    table.p td{overflow-wrap:anywhere}
    table.p th{background:${TEAL};color:#fff;padding:7px 6px;text-align:left;font-size:9px}
    table.p td{border:1px solid #ddd;padding:6px;vertical-align:top;font-size:9px;line-height:1.35}
    table.p thead{display:table-header-group}
    table.p tr{page-break-inside:avoid}
    .r{text-align:right}
    .imp{font-size:6.5px;color:#444;margin-top:2px}
    .sello{background:#eee;padding:6px 8px;font-size:5.5px;line-height:1.3;word-break:break-all;border-radius:0 0 8px 8px;min-height:40px}
  </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
      <div>${logo ? `<img src="${logo}" style="height:60px">` : `<b style="font-size:16px;color:${TEAL}">${esc(e.nombre)}</b>`}</div>
      <div style="width:52%">
        ${remision ? '' : '<div style="text-align:right;font-weight:bold;font-size:8px;color:#555;margin-bottom:3px">Versión: 4.0</div>'}
        <div style="display:flex;gap:4px">
          ${remision ? '' : `<div style="flex:2"><div class="bar">No. Certificado:</div><div class="cell">${esc(cfdi?.cert_emisor) || '&nbsp;'}</div></div>`}
          <div style="flex:1"><div class="bar">${remision ? 'REMISIÓN:' : 'FACTURA:'}</div><div class="cell">${esc(folioMostrado)}</div></div>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:4px">
      <div style="flex:1"><div class="bar">EMISOR:</div><div class="box">
        <div style="font-size:11px;font-weight:bold">${esc(e.nombre)}</div>
        <div><b>Razón Social:</b> ${esc(e.razonSocial)}</div>
        <div><b>RFC:</b> ${esc(e.rfc)}</div>
        <div><b>Régimen Fiscal:</b> ${esc(conCatalogo(REGIMENES_SAT, e.regimen))}</div>
        <div><b>Dirección:</b> ${esc(e.direccion)}</div>
      </div></div>
      <div style="flex:1"><div class="bar">RECEPTOR:</div><div class="box">
        <div><b>Razón Social:</b> ${esc(ent.cliente_nombre)}</div>
        <div><b>RFC:</b> ${esc(ent.cliente_rfc)}</div>
        ${remision ? '' : `<div><b>Régimen Fiscal:</b> ${esc(conCatalogo(REGIMENES_SAT, ent.cliente_regimen_fiscal))}</div>
        <div><b>Uso CFDI:</b> ${esc(conCatalogo(USOS_CFDI_SAT, ent.uso_cfdi))}</div>`}
        ${remision && ent.atencion ? `<div><b>Atención:</b> ${esc(ent.atencion)}</div>` : ''}
        ${remision && ent.pedido_cliente ? `<div><b>Pedido del cliente:</b> ${esc(ent.pedido_cliente)}</div>` : ''}
        <div><b>Dirección:</b> ${esc(direccionReceptor)}</div>
      </div></div>
    </div>
    <div class="grid3">
      ${celda('Fecha:', fechaIso(ent.created_at))}
      ${celda('Lugar de Expedición:', e.cp)}
      ${remision ? celda('Pedido:', ent.pedido_folio || '') : celda('Tipo de Comprobante:', 'I')}
      ${celda('Moneda:', moneda)}
      ${remision ? '' : `${celda('Tipo de Cambio:', '1.000000')}
      ${celda('Forma de Pago:', conCatalogo(FORMAS_PAGO_SAT, ent.forma_pago))}
      ${celda('Método de Pago:', conCatalogo(METODOS_PAGO_SAT, ent.metodo_pago))}`}
    </div>
    <table class="p">
      <colgroup><col style="width:11%"><col style="width:6%"><col style="width:8%"><col><col style="width:11%"><col style="width:7%"><col style="width:12%"></colgroup>
      <thead><tr><th>Código:</th><th class="r">Cant.</th><th>Unidad:</th><th>Descripción:</th><th class="r">P Unitario:</th><th class="r">Desc.:</th><th class="r">Importe:</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div style="display:flex;gap:8px;margin-top:8px;align-items:stretch;break-inside:avoid">
      ${cfdi?.qr_dataurl ? `<img src="${cfdi.qr_dataurl}" style="width:120px;height:120px">` : ''}
      <div class="box" style="flex:1">
        <div><b>Importe en letra:</b> ${esc(importeEnLetra(total, moneda))}</div>
        ${ent.notas ? `<div style="white-space:pre-line"><b>Observaciones:</b> ${esc(ent.notas)}</div>` : ''}
        ${remision ? '<div style="color:#777">Documento de remisión sin validez fiscal.</div>' : cfdi ? `
        <div><b>Folio Fiscal UUID:</b>${esc(cfdi.uuid)}</div>
        <div><b>Fecha de Timbrado:</b> ${esc(fechaIso(cfdi.fecha_timbrado))}</div>
        <div><b>RFC Proveedor de Certificación:</b> ${esc(cfdi.rfc_prov_certif)}</div>
        <div><b>No. Certificado SAT:</b> ${esc(cfdi.cert_sat)}</div>` : '<div style="color:#777">Pendiente de timbrado.</div>'}
      </div>
      <div style="width:210px;border:1px solid #ddd;border-radius:0 0 10px 0;padding:6px 10px;line-height:2">
        <div style="display:flex;justify-content:space-between"><b>SubTotal:</b><b>${num(subtotal)}</b></div>
        <div style="display:flex;justify-content:space-between"><b>IVA:</b><b>${num(iva)}</b></div>
        <div style="display:flex;justify-content:space-between;color:${TEAL}"><b>Total:</b><b>${num(total)}</b></div>
      </div>
    </div>
    ${cfdi ? `<div style="display:flex;gap:6px;margin-top:8px;break-inside:avoid">
      ${sello('Sello SAT:', cfdi.sello_sat)}${sello('Sello CFD:', cfdi.sello_cfdi)}${sello('Cadena original SAT:', cfdi.cadena_original_tfd)}
    </div>` : ''}
  </body></html>`;
}

function footerFactura(timbrado, remision = false) {
  const web = process.env.EMPRESA_WEB || '';
  const ley = remision ? 'Documento de remisión sin validez fiscal.' : timbrado
    ? 'Este documento es una representación impresa de un CFDI.'
    : 'Documento previo al timbrado, sin validez fiscal.';
  return `<div style="font-size:8px;font-style:italic;color:#555;width:100%;padding:0 10mm;box-sizing:border-box;display:flex;justify-content:space-between">
    <span>${esc(web)}${web ? ' | ' : ''}${ley}</span>
    <span>Pág. <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`;
}

// Compatibilidad con capturar_factura.js (mismo nombre y firma).
function buildFacturaCfdiHtml(ent, cfdi) { return buildFacturaHtml(ent, cfdi); }

async function generarOcPdf(oc) { return renderPdf(buildOcHtml(oc), oc.folio); }
async function generarEntregaPdf(ent) {
  return renderPdf(buildEntregaHtml(ent), ent.folio, footerFactura(false, ent.tipo !== 'factura'));
}
// PDF de la factura timbrada (CFDI). Usa un folio distinto para no pisar el PDF previo al timbrado.
async function generarFacturaCfdiPdf(ent, cfdi) {
  return renderPdf(buildFacturaHtml(ent, cfdi), `${ent.folio}-CFDI`, footerFactura(true));
}

module.exports = { generarOcPdf, generarEntregaPdf, generarFacturaCfdiPdf, buildFacturaCfdiHtml };
