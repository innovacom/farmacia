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
    base_iva_ret: null, tasa_iva_ret: null, importe_iva_ret: null,
  };
  const imp = concepto.Impuestos;
  if (!imp) return out;
  for (const t of arr(imp.Traslados?.Traslado)) {
    if (t['@_Impuesto'] === '002') { out.base_iva = numN(t['@_Base']); out.tasa_iva = numN(t['@_TasaOCuota']); out.importe_iva = numN(t['@_Importe']); }
    else if (t['@_Impuesto'] === '003') { out.base_ieps = numN(t['@_Base']); out.tasa_ieps = numN(t['@_TasaOCuota']); out.importe_ieps = numN(t['@_Importe']); }
  }
  // Retenciones: 001=ISR, 002=IVA. Antes solo se leía ISR — sin la de IVA no se puede
  // separar "ISR retenido" de "IVA retenido" en las pólizas (quedaban mezcladas en el
  // total del encabezado). Ver Reporte Módulo Contable DISMED, limitación de retenciones.
  for (const r of arr(imp.Retenciones?.Retencion)) {
    if (r['@_Impuesto'] === '001') { out.base_isr = numN(r['@_Base']); out.tasa_isr = numN(r['@_TasaOCuota']); out.importe_isr = numN(r['@_Importe']); }
    else if (r['@_Impuesto'] === '002') { out.base_iva_ret = numN(r['@_Base']); out.tasa_iva_ret = numN(r['@_TasaOCuota']); out.importe_iva_ret = numN(r['@_Importe']); }
  }
  return out;
}

// Complemento de pago (CFDI 4.0): el IVA de CADA parcialidad puede venir explícito en
// DoctoRelacionado/ImpuestosDR/TrasladosDR (impuesto '002'). Cuando no viene (CFDI 3.3
// o pago que no desglosa impuestos), el motor de pólizas prorratea con el total de la
// factura relacionada.
function impuestosDoctoRelacionado(d) {
  let importe_iva_dr = null;
  const imp = d.ImpuestosDR;
  if (imp) {
    for (const t of arr(imp.TrasladosDR?.TrasladoDR)) {
      if (t['@_ImpuestoDR'] === '002') importe_iva_dr = numN(t['@_ImporteDR']);
    }
  }
  return { importe_iva_dr };
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
  const pagosDoctos = [];
  if (comprobante.tipo_comprobante === 'P') {
    const pagosComp = c.Complemento?.Pagos;
    if (pagosComp) {
      const montoTotal = num(pagosComp.Totales?.['@_MontoTotalPagos'])
        || arr(pagosComp.Pago).reduce((s, p) => s + num(p['@_Monto']), 0);
      if (montoTotal) {
        comprobante.subtotal = montoTotal;
        comprobante.total = montoTotal;
      }
      const doctoUuids = [];
      for (const p of arr(pagosComp.Pago)) {
        for (const d of arr(p.DoctoRelacionado)) {
          const uuidDoc = str(d['@_IdDocumento']);
          if (!uuidDoc) continue;
          const uuidUp = uuidDoc.toUpperCase();
          doctoUuids.push(uuidUp);
          pagosDoctos.push({
            uuid_documento: uuidUp,
            moneda_dr: str(d['@_MonedaDR']),
            equivalencia_dr: numN(d['@_EquivalenciaDR']),
            num_parcialidad: d['@_NumParcialidad'] ? Number(d['@_NumParcialidad']) : null,
            imp_saldo_ant: numN(d['@_ImpSaldoAnt']),
            imp_pagado: num(d['@_ImpPagado']),
            imp_saldo_insoluto: numN(d['@_ImpSaldoInsoluto']),
            objeto_imp_dr: str(d['@_ObjetoImpDR']),
            ...impuestosDoctoRelacionado(d),
          });
        }
      }
      if (doctoUuids.length) {
        comprobante.cfdi_relacionados = [...new Set(doctoUuids)].join(',');
      }
    }
  }

  return { comprobante, conceptos, pagos_doctos: pagosDoctos };
}

module.exports = { parseCfdi };
