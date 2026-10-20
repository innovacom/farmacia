/**
 * cfdi.facturadigital.js — Adaptador del PAC Factura Digital (API v5, docs.facturadigital.com.mx).
 *
 * El resto del sistema arma el comprobante en el formato interno heredado de Facturama
 * (Receiver / Items / Taxes…). Este módulo lo traduce al JSON de Factura Digital
 * (Emisor / Receptor / Conceptos / Impuestos) y normaliza la respuesta a la misma forma
 * que devuelve Facturama, para que cfdi.facturama.js#timbrarComprobante no distinga PAC.
 *
 * Variables de entorno:
 *   CFDI_AMBIENTE                   — 'sandbox' (default) | 'produccion'
 *   FACTURADIGITAL_API_KEY_SANDBOX  — X-Api-Key del ambiente sandbox
 *   FACTURADIGITAL_API_KEY          — X-Api-Key de producción
 *   FACTURADIGITAL_URL_SANDBOX      — default https://sandbox-app.facturadigital.com.mx
 *   FACTURADIGITAL_URL              — default https://app.facturadigital.com.mx
 *   FACTURADIGITAL_SERIE            — serie opcional (si no, se usa body.Serie)
 *   EMPRESA_REGIMEN_FISCAL          — régimen del emisor (el RFC/CSD los toma el PAC de la cuenta)
 */
const { empresaCfdi } = require('./cfdi.txt.generator');
const { getCfdiConfig } = require('../../config/cfdiPac');

const URL_SANDBOX = 'https://sandbox-app.facturadigital.com.mx';
const URL_PRODUCCION = 'https://app.facturadigital.com.mx';

// El ambiente (sandbox/produccion) viene de Configuración (BD) con fallback a CFDI_AMBIENTE.
function baseUrl(produccion) {
  const u = produccion
    ? (process.env.FACTURADIGITAL_URL || URL_PRODUCCION)
    : (process.env.FACTURADIGITAL_URL_SANDBOX || URL_SANDBOX);
  return u.replace(/\/+$/, '');
}
function claveConfigurada(produccion) {
  return !!(produccion ? process.env.FACTURADIGITAL_API_KEY : process.env.FACTURADIGITAL_API_KEY_SANDBOX);
}
function apiKey(produccion) {
  const k = produccion ? process.env.FACTURADIGITAL_API_KEY : process.env.FACTURADIGITAL_API_KEY_SANDBOX;
  if (!k) {
    const e = new Error(`Factura Digital: falta ${produccion ? 'FACTURADIGITAL_API_KEY' : 'FACTURADIGITAL_API_KEY_SANDBOX'} en el .env`);
    e.status = 503; throw e;
  }
  return k.trim();
}

async function llamar(metodo, ruta, form, extraHeaders = {}) {
  const produccion = (await getCfdiConfig()).ambiente === 'produccion';
  const headers = { 'X-Api-Key': apiKey(produccion), ...extraHeaders };
  const opts = { method: metodo, headers };
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(form).toString();
  }
  const res = await fetch(baseUrl(produccion) + ruta, opts);
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (_) { /* no JSON */ }
  // La API responde {message, code}; code 200 = éxito (el HTTP status no siempre es fiable).
  const code = json?.code ?? res.status;
  if (!res.ok || Number(code) !== 200) {
    const e = new Error(`Factura Digital: ${json?.message || texto.slice(0, 300) || 'HTTP ' + res.status}`);
    e.status = 422; e.pacCode = code; throw e;
  }
  return json || {};
}

const n2 = (n) => Number(n || 0).toFixed(2);

/** Traduce el body interno (formato Facturama) al JSON de Factura Digital. */
function traducirBody(b) {
  const emp = empresaCfdi();
  const conceptos = (b.Items || []).map((it) => {
    const impuestos = {};
    const traslados = [];
    const retenciones = [];
    for (const t of it.Taxes || []) {
      const imp = {
        Base: n2(t.Base), Impuesto: t.Name === 'IEPS' ? '003' : t.Name === 'ISR' ? '001' : '002',
        TipoFactor: 'Tasa', TasaOCuota: Number(t.Rate).toFixed(6), Importe: n2(t.Total),
      };
      (t.IsRetention ? retenciones : traslados).push(imp);
    }
    if (traslados.length) impuestos.Traslados = traslados;
    if (retenciones.length) impuestos.Retenciones = retenciones;
    const c = {
      ClaveProdServ: it.ProductCode,
      NoIdentificacion: it.IdentificationNumber || undefined,
      Cantidad: String(it.Quantity),
      ClaveUnidad: it.UnitCode,
      Unidad: it.Unit || undefined,
      Descripcion: it.Description,
      ValorUnitario: String(it.UnitPrice),
      Importe: n2(it.Subtotal),
      Descuento: Number(it.Discount) > 0 ? n2(it.Discount) : undefined,
      ObjetoImp: it.TaxObject || '02',
    };
    if (c.ObjetoImp !== '01') c.Impuestos = impuestos;
    return c;
  });

  // Totales de impuestos a nivel comprobante, agrupados por impuesto+tasa.
  const grupos = new Map();
  let totalTras = 0;
  for (const c of conceptos) {
    for (const t of c.Impuestos?.Traslados || []) {
      const k = `${t.Impuesto}|${t.TasaOCuota}`;
      const g = grupos.get(k) || { ...t, Base: 0, Importe: 0 };
      g.Base += Number(t.Base); g.Importe += Number(t.Importe);
      grupos.set(k, g);
    }
  }
  const trasladosRaiz = [...grupos.values()].map((g) => {
    totalTras += g.Importe;
    return { ...g, Base: n2(g.Base), Importe: n2(g.Importe) };
  });

  const subtotal = conceptos.reduce((s, c) => s + Number(c.Importe), 0);
  const descuento = conceptos.reduce((s, c) => s + Number(c.Descuento || 0), 0);
  const total = subtotal - descuento + totalTras;

  const out = {
    Version: '4.0',
    Serie: b.Serie || process.env.FACTURADIGITAL_SERIE || undefined,
    Fecha: 'AUTO',
    FormaPago: b.PaymentForm,
    SubTotal: n2(subtotal),
    Descuento: descuento ? n2(descuento) : undefined,
    Moneda: b.Currency || 'MXN',
    TipoCambio: '1',
    Total: n2(total),
    TipoDeComprobante: b.CfdiType || 'I',
    MetodoPago: b.PaymentMethod,
    LugarExpedicion: b.ExpeditionPlace,
    Exportacion: b.Exportation || '01',
    Emisor: { RegimenFiscal: emp.regimen },
    Receptor: {
      Rfc: b.Receiver.Rfc,
      Nombre: b.Receiver.Name,
      UsoCFDI: b.Receiver.CfdiUse,
      RegimenFiscalReceptor: b.Receiver.FiscalRegime,
      DomicilioFiscalReceptor: b.Receiver.TaxZipCode,
    },
    Conceptos: conceptos,
    Impuestos: trasladosRaiz.length
      ? { TotalImpuestosTrasladados: n2(totalTras), Traslados: trasladosRaiz }
      : undefined,
  };
  if (b.Observations) out.Observaciones = b.Observations;
  if (b.GlobalInformation) {
    out.InformacionGlobal = {
      Periodicidad: b.GlobalInformation.Periodicity,
      Meses: b.GlobalInformation.Months,
      'Año': String(b.GlobalInformation.Year),
    };
  }
  return out;
}

const attr = (xml, nombre) => (xml.match(new RegExp(`\\b${nombre}="([^"]*)"`)) || [])[1] || null;

/**
 * Timbra y devuelve { resp, xml } donde `resp` imita la respuesta de Facturama
 * (Id, Serie, Folio, Total, Issuer, Receiver, Complement.TaxStamp…).
 * Id = UUID: Factura Digital cancela por UUID, no por id interno.
 */
async function timbrar(body) {
  const j = await llamar('POST', '/api/v5/invoice/create', { json: JSON.stringify(traducirBody(body)) });
  const c = j.cfdi || {};
  if (!c.UUID) { const e = new Error('Factura Digital no devolvió UUID en el timbre'); e.status = 422; throw e; }
  const xml = c.XmlBase64 ? Buffer.from(c.XmlBase64, 'base64').toString('utf8') : '';
  const cab = xml.match(/<cfdi:Comprobante[^>]*>/)?.[0] || '';
  const emisor = xml.match(/<cfdi:Emisor[^>]*>/)?.[0] || '';
  const receptor = xml.match(/<cfdi:Receptor[^>]*>/)?.[0] || '';
  const uuid = String(c.UUID).toUpperCase();
  const resp = {
    Id: uuid,
    Serie: attr(cab, 'Serie') || c.Serie || null,
    Folio: attr(cab, 'Folio') || c.Folio || null,
    Total: attr(cab, 'Total'),
    CertNumber: c.NoCertificado || attr(cab, 'NoCertificado'),
    OriginalString: null,
    Issuer: { Rfc: attr(emisor, 'Rfc'), TaxName: attr(emisor, 'Nombre') },
    Receiver: { Rfc: attr(receptor, 'Rfc') },
    Complement: {
      TaxStamp: {
        Uuid: uuid, Date: c.FechaTimbrado, CfdiSign: c.SelloCFD, SatSign: c.SelloSAT,
        SatCertNumber: c.NoCertificadoSAT, RfcProvCertif: c.RfcProvCertif,
      },
    },
    pac: 'facturadigital',
    pdf_pac: c.PDF || null,
    xml_pac: c.XML || null,
  };
  return { resp, xml };
}

/** Cancela por UUID. motivo 01 requiere uuidSustituye. */
async function cancelar(uuid, motivo, uuidSustituye) {
  // La API recibe uuid/motivo/foliosustitucion como HEADERS, no en el cuerpo.
  const h = { uuid, motivo };
  if (motivo === '01') h.foliosustitucion = uuidSustituye;
  return llamar('POST', '/api/v5/invoice/cancel', null, h);
}

/** Verifica credenciales/ambiente: devuelve los créditos (timbres) disponibles. */
async function saldo() {
  return llamar('GET', '/api/v5/account/balance');
}

module.exports = { timbrar, cancelar, saldo, traducirBody, claveConfigurada, baseUrl };
