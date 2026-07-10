/**
 * test_cfdi_facturama.js — Prueba en vivo del timbrado + integración en el PDF.
 * NO toca la BD: timbra una factura global de prueba en el sandbox, deriva la cadena
 * original del TFD y el QR igual que el servicio, y genera NUESTRO PDF con el bloque fiscal.
 *   node test_cfdi_facturama.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { generarFacturaCfdiPdf } = require('./src/modules/ventas/ventas.pdf');

const BASE = (process.env.FACTURAMA_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + (process.env.FACTURAMA_TOKEN || '');

async function fJson(method, ruta, body) {
  const res = await fetch(BASE + ruta, {
    method,
    headers: { Authorization: AUTH, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${ruta} → ${res.status}: ${txt}`);
  return JSON.parse(txt);
}

(async () => {
  // 1) Timbrar una factura global de prueba (público en general) en sandbox.
  const body = {
    Receiver: { Name: 'PUBLICO EN GENERAL', CfdiUse: 'S01', Rfc: 'XAXX010101000', FiscalRegime: '616', TaxZipCode: process.env.EMPRESA_CP || '04410' },
    CfdiType: 'I', ExpeditionPlace: process.env.EMPRESA_CP || '04410',
    PaymentForm: '01', PaymentMethod: 'PUE', Currency: 'MXN', Exportation: '01',
    GlobalInformation: { Periodicity: '01', Months: '06', Year: 2026 },
    Items: [{
      Quantity: '2', ProductCode: '42182200', UnitCode: 'H87', Unit: 'Pieza',
      Description: 'Guante de exploracion latex (prueba DISMED)', IdentificationNumber: 'DM-00001',
      UnitPrice: '150.00', Subtotal: '300.00', Discount: '0.00', TaxObject: '02',
      Taxes: [{ Name: 'IVA', Rate: '0.160000', Total: '48.00', Base: '300.00', IsRetention: false, IsFederalTax: true }],
      Total: '348.00',
    }],
  };
  console.log('Timbrando en', BASE, '...');
  const resp = await fJson('POST', '/3/cfdis', body);
  const tfd = resp.Complement.TaxStamp;
  console.log('OK timbrado. UUID:', tfd.Uuid, '| Folio:', resp.Folio, '| Id:', resp.Id);

  // 2) Derivar cadena original del TFD y QR (idéntico al servicio).
  const cadenaTfd = `||1.1|${tfd.Uuid}|${tfd.Date}|${tfd.RfcProvCertif}|${tfd.CfdiSign}|${tfd.SatCertNumber}||`;
  const rfcEmisor = (resp.Issuer.Rfc || '').toUpperCase();
  const rfcReceptor = (resp.Receiver.Rfc || '').toUpperCase();
  const total = String(resp.Total);
  const qrUrl = `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${tfd.Uuid}&re=${rfcEmisor}&rr=${rfcReceptor}&tt=${total}&fe=${(tfd.CfdiSign || '').slice(-8)}`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl);

  // 3) Descargar el XML timbrado y guardarlo (obligación fiscal).
  const xmlResp = await fJson('GET', `/cfdi/xml/issued/${resp.Id}`);
  const xml = Buffer.from(xmlResp.Content, 'base64').toString('utf8');
  const xmlDir = path.resolve(process.env.OUTPUT_DIR || './outputs', 'cfdi', '2026');
  fs.mkdirSync(xmlDir, { recursive: true });
  fs.writeFileSync(path.join(xmlDir, 'FAC-TEST.xml'), xml, 'utf8');
  console.log('XML guardado (', xml.length, 'chars). Contiene UUID:', xml.includes(tfd.Uuid), '| Contiene Sello SAT:', xml.includes(tfd.SatSign.slice(0, 40)));

  // 4) Generar NUESTRO PDF con el bloque fiscal (sello + cadena original + timbre + QR).
  const entregaFake = {
    folio: 'FAC-TEST', tipo: 'factura', cliente_nombre: 'PUBLICO EN GENERAL', pedido_folio: 'PED-TEST',
    partidas: [{ sku_interno: 'DM-00001', descripcion: 'Guante de exploracion latex (prueba DISMED)', cantidad: 2, unidad_medida: 'Pieza', precio_unitario: 150, iva_exento: 0 }],
  };
  const cfdiData = {
    uuid: tfd.Uuid, folio: resp.Folio, serie: resp.Serie, fecha_timbrado: tfd.Date,
    sello_cfdi: tfd.CfdiSign, sello_sat: tfd.SatSign, cert_emisor: resp.CertNumber, cert_sat: tfd.SatCertNumber,
    rfc_prov_certif: tfd.RfcProvCertif, cadena_original_tfd: cadenaTfd, cadena_original_comprobante: resp.OriginalString,
    qr_url: qrUrl, qr_dataurl: qrDataUrl, emisor_nombre: resp.Issuer.TaxName, emisor_rfc: rfcEmisor, total,
  };
  const out = await generarFacturaCfdiPdf(entregaFake, cfdiData);
  const stat = fs.statSync(out.filePath);
  console.log('PDF generado:', out.relativePath, '|', Math.round(stat.size / 1024), 'KB');
  console.log('\nCadena original TFD:\n', cadenaTfd);
  console.log('\nQR SAT:', qrUrl);
  console.log('\n=== PRUEBA OK: timbre real integrado en el PDF ===');
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
