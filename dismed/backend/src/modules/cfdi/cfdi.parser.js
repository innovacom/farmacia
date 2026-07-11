/**
 * cfdi.parser.js — Convierte un CFDI 4.0 (XML) al modelo encabezado–detalle
 * de cfdi_repositorio / cfdi_repositorio_conceptos.
 *
 * Soporta CFDI 4.0 y 3.3 (mismas etiquetas base). Usa fast-xml-parser con
 * removeNSPrefix para ignorar los prefijos cfdi:/tfd:.
 *
 * Devuelve: { comprobante: {...}, conceptos: [{...}] }
 * `tipo` (emitido/recibido) se deduce comparando el RFC emisor con el RFC propio
 * (env EMPRESA_RFC, sobreescribible por argumento).
 */
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false, // conservamos strings; convertimos nosotros
  trimValues: true,
});

const num = (v) => (v == null || v === '' ? 0 : Number(v));
const numN = (v) => (v == null || v === '' ? null : Number(v));
const str = (v) => (v == null ? null : String(v).trim() || null);
// fast-xml-parser entrega un objeto si hay 1 nodo, array si hay varios.
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Impuestos: 001=ISR, 002=IVA, 003=IEPS
function impuestosConcepto(concepto) {
  const out = {
    base_iva: null, tasa_iva: null, importe_iva: null,
    base_ieps: null, tasa_ieps: null, importe_ieps: null,
    base_isr: null, tasa_isr: null, importe_isr: null,
  };
  const imp = concepto.Impuestos;
  if (!imp) return out;
  for (const t of arr(imp.Traslados?.Traslado)) {
    if (t['@_Impuesto'] === '002') { out.base_iva = numN(t['@_Base']); out.tasa_iva = numN(t['@_TasaOCuota']); out.importe_iva = numN(t['@_Importe']); }
    else if (t['@_Impuesto'] === '003') { out.base_ieps = numN(t['@_Base']); out.tasa_ieps = numN(t['@_TasaOCuota']); out.importe_ieps = numN(t['@_Importe']); }
  }
  for (const r of arr(imp.Retenciones?.Retencion)) {
    if (r['@_Impuesto'] === '001') { out.base_isr = numN(r['@_Base']); out.tasa_isr = numN(r['@_TasaOCuota']); out.importe_isr = numN(r['@_Importe']); }
  }
  return out;
}

function parseCfdi(xml, { rfcPropio = process.env.EMPRESA_RFC || 'RIC1903041Q2' } = {}) {
  const root = parser.parse(xml);
  const c = root.Comprobante;
  if (!c) throw new Error('XML sin nodo Comprobante (¿no es un CFDI?)');

  const emisor = c.Emisor || {};
  const receptor = c.Receptor || {};
  const tfd = c.Complemento?.TimbreFiscalDigital || c.Complemento?.['TimbreFiscalDigital'] || {};
  const totalImp = c.Impuestos || {};

  const rfcEmisor = str(emisor['@_Rfc']) || '';
  const tipo = rfcEmisor.toUpperCase() === String(rfcPropio).toUpperCase() ? 'emitido' : 'recibido';

  const rel = c.CfdiRelacionados;
  const uuidsRel = arr(rel?.CfdiRelacionado).map((x) => str(x['@_UUID'])).filter(Boolean);

  const comprobante = {
    uuid: (str(tfd['@_UUID']) || '').toUpperCase() || null,
    tipo,
    tipo_comprobante: str(c['@_TipoDeComprobante']) || 'I',
    version: str(c['@_Version']) || '4.0',
    serie: str(c['@_Serie']),
    folio: str(c['@_Folio']),
    fecha: str(c['@_Fecha']),
    fecha_timbrado: str(tfd['@_FechaTimbrado']),
    rfc_emisor: rfcEmisor,
    nombre_emisor: str(emisor['@_Nombre']),
    regimen_fiscal_emisor: str(emisor['@_RegimenFiscal']),
    rfc_receptor: str(receptor['@_Rfc']) || '',
    nombre_receptor: str(receptor['@_Nombre']),
    uso_cfdi: str(receptor['@_UsoCFDI']),
    domicilio_fiscal_receptor: str(receptor['@_DomicilioFiscalReceptor']),
    regimen_fiscal_receptor: str(receptor['@_RegimenFiscalReceptor']),
    lugar_expedicion: str(c['@_LugarExpedicion']),
    metodo_pago: str(c['@_MetodoPago']),
    forma_pago: str(c['@_FormaPago']),
    condiciones_pago: str(c['@_CondicionesDePago']),
    moneda: str(c['@_Moneda']) || 'MXN',
    tipo_cambio: numN(c['@_TipoCambio']),
    subtotal: num(c['@_SubTotal']),
    descuento: num(c['@_Descuento']),
    total: num(c['@_Total']),
    total_impuestos_trasladados: numN(totalImp['@_TotalImpuestosTrasladados']),
    total_impuestos_retenidos: numN(totalImp['@_TotalImpuestosRetenidos']),
    tipo_relacion: str(rel?.['@_TipoRelacion']),
    cfdi_relacionados: uuidsRel.length ? uuidsRel.join(',') : null,
    no_certificado: str(c['@_NoCertificado']),
    no_certificado_sat: str(tfd['@_NoCertificadoSAT']),
    pac_rfc: str(tfd['@_RfcProvCertif']),
    origen: 'sat',
  };

  const conceptos = arr(c.Conceptos?.Concepto).map((cn, i) => ({
    linea: i + 1,
    clave_prod_serv: str(cn['@_ClaveProdServ']),
    no_identificacion: str(cn['@_NoIdentificacion']),
    cantidad: num(cn['@_Cantidad']),
    clave_unidad: str(cn['@_ClaveUnidad']),
    unidad: str(cn['@_Unidad']),
    descripcion: str(cn['@_Descripcion']),
    valor_unitario: num(cn['@_ValorUnitario']),
    importe: num(cn['@_Importe']),
    descuento: num(cn['@_Descuento']),
    objeto_imp: str(cn['@_ObjetoImp']),
    ...impuestosConcepto(cn),
    codigo_interno: null,
  }));

  // Nómina: el @_Descuento en los conceptos representa deducciones salariales (ISR u otras),
  // no un descuento comercial. El ISR real está en r.total_impuestos_retenidos (encabezado).
  if (comprobante.tipo_comprobante === 'N') {
    for (const cn of conceptos) cn.descuento = 0;
  }

  // Pagos: el SAT exige SubTotal=0 y Total=0 en el nodo raíz Comprobante.
  // Los montos reales y los CFDIs pagados están en Complemento/Pagos.
  if (comprobante.tipo_comprobante === 'P') {
    const pagosComp = c.Complemento?.Pagos;
    if (pagosComp) {
      const montoTotal = num(pagosComp.Totales?.['@_MontoTotalPagos'])
        || arr(pagosComp.Pago).reduce((s, p) => s + num(p['@_Monto']), 0);
      if (montoTotal) {
        comprobante.subtotal = montoTotal;
        comprobante.total = montoTotal;
      }
      const doctoUuids = arr(pagosComp.Pago)
        .flatMap((p) => arr(p.DoctoRelacionado).map((d) => str(d['@_IdDocumento'])))
        .filter(Boolean)
        .map((u) => u.toUpperCase());
      if (doctoUuids.length) {
        comprobante.cfdi_relacionados = doctoUuids.join(',');
      }
    }
  }

  return { comprobante, conceptos };
}

module.exports = { parseCfdi };
