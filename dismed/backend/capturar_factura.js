/**
 * capturar_factura.js — Renderiza una factura CFDI de ejemplo (representación impresa
 * con sello, cadena original, timbre y QR) a PNG para el manual.
 * Usa datos de muestra (no toca la API ni la BD).
 *   node capturar_factura.js
 */
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer');
const { buildFacturaCfdiHtml } = require('./src/modules/ventas/ventas.pdf');

const outDir = path.resolve(__dirname, '../frontend/public/ayuda');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const uuid = 'A1B2C3D4-5E6F-7A8B-9C0D-1E2F3A4B5C6D';
  const selloDemo = 'kr5IrlDuCw7JVHVw/UjpRuL0Z1I7GaY0OCx81K2h/dcTtcUbFmmJ1BGydS52mB+XuuDsnirD7s0cU3/+Hrd9uLU1/0z0Zt85orwk+QSb5Py03qV7KS0JUOT7dBOdtTxBZf0GpJba0lu3YXEj9O4wP37E883LmLSeC3SnYdRg5P1W==';
  const cadenaTfd = `||1.1|${uuid}|2026-06-18T12:00:00|SPR190613I52|${selloDemo}|30001000000500003456||`;
  const qrUrl = `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${uuid}&re=RIC1903041Q2&rr=PEP830101AAA&tt=4060.00&fe=${selloDemo.slice(-8)}`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl);

  const ent = {
    folio: 'FAC-2026-0001', tipo: 'factura', cliente_nombre: 'HOSPITAL DE EJEMPLO, S.A. DE C.V.', pedido_folio: 'PED-2026-0001',
    partidas: [
      { sku_interno: 'DM-00125', descripcion: 'Guante para exploración de látex, caja c/100', cantidad: 20, unidad_medida: 'Caja', precio_unitario: 175, iva_exento: 0 },
      { sku_interno: 'DM-00342', descripcion: 'Jeringa desechable 5 ml con aguja', cantidad: 100, unidad_medida: 'Pieza', precio_unitario: 5, iva_exento: 0 },
    ],
  };
  const cfdi = {
    uuid, folio: '1', serie: '', fecha_timbrado: '2026-06-18T12:00:00',
    sello_cfdi: selloDemo, sello_sat: selloDemo, cert_emisor: '00001000000700584318', cert_sat: '30001000000500003456',
    rfc_prov_certif: 'SPR190613I52', cadena_original_tfd: cadenaTfd, cadena_original_comprobante: '||4.0|1|...||',
    qr_url: qrUrl, qr_dataurl: qrDataUrl, emisor_nombre: 'RODRICABR INNOVACION Y COMERCIO', emisor_rfc: 'RIC1903041Q2', total: '4060.00',
  };

  const html = buildFacturaCfdiHtml(ent, cfdi);
  const browser = await puppeteer.launch({
    headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 1035, deviceScaleFactor: 2 });
  await page.setContent(`<div style="padding:24px;background:#fff">${html}</div>`, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(outDir, 'factura_cfdi.png'), fullPage: true });
  await browser.close();
  console.log('OK factura_cfdi.png');
  process.exit(0);
})();
