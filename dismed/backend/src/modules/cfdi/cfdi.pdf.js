/**
 * cfdi.pdf.js — Representación impresa (PDF) de un CFDI del repositorio,
 * a partir del XML crudo guardado en disco (cfdi_repositorio.xml_path).
 *
 * Reproduce el layout genérico del SAT: dos variantes según tipo de
 * comprobante — Ingreso/Egreso/Traslado/Nómina (factura estándar) y Pago
 * (recepción de pagos, con documentos relacionados). Referencia visual:
 * "factura ingreso.pdf" y "complemento de pago.pdf" (raíz del repo).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const { XMLParser } = require('fast-xml-parser');
const { pool } = require('../../config/db');
const { esc } = require('../../utils/html');

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true,
  parseAttributeValue: false, trimValues: true,
});

// fast-xml-parser decode entidades nombradas (&amp;) pero deja las numéricas
// (&#xA;, &#10;) literales en valores de atributo — se ven así en varios CFDI
// reales (descripciones con salto de línea). Las decodificamos a mano.
const decodeNumEntities = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
const str = (v) => (v == null ? '' : decodeNumEntities(String(v)).trim());
const num = (v) => (v == null || v === '' ? 0 : Number(v));
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const fmt = (n) => '$ ' + num(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (t) => (t == null || t === '' ? '' : `${(Number(t) * 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const fdt = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? str(v) : d.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

// ── Catálogos SAT (estáticos, para mostrar descripción en vez de solo el código) ──
const C_TIPO = { I: 'Ingreso', E: 'Egreso', T: 'Traslado', N: 'Nómina', P: 'Pago' };
const C_METODO_PAGO = { PUE: 'Pago en una sola exhibición', PPD: 'Pago en parcialidades o diferido' };
const C_EXPORTACION = {
  '01': 'No aplica', '02': 'Definitiva', '03': 'Temporal',
  '04': 'Definitiva con clave distinta a A1 o Definitiva con clave A1 y con Descripción específica',
};
const C_OBJETO_IMP = {
  '01': 'No objeto de impuesto', '02': 'Sí objeto de impuesto',
  '03': 'Sí objeto del impuesto y no obligado al desglose', '04': 'Sí objeto del impuesto y no causa impuesto',
};
const C_FORMA_PAGO = {
  '01': 'Efectivo', '02': 'Cheque nominativo', '03': 'Transferencia electrónica de fondos',
  '04': 'Tarjeta de crédito', '05': 'Monedero electrónico', '06': 'Dinero electrónico',
  '08': 'Vales de despensa', '12': 'Dación en pago', '13': 'Pago por subrogación',
  '14': 'Pago por consignación', '15': 'Condonación', '17': 'Compensación', '23': 'Novación',
  '24': 'Confusión', '25': 'Remisión de deuda', '26': 'Prescripción o caducidad',
  '27': 'A satisfacción del acreedor', '28': 'Tarjeta de débito', '29': 'Tarjeta de servicios',
  '30': 'Aplicación de anticipos', '31': 'Intermediario pagos', '99': 'Por definir',
};
const C_REGIMEN = {
  '601': 'General de Ley Personas Morales', '603': 'Personas Morales con Fines no Lucrativos',
  '605': 'Sueldos y Salarios e Ingresos Asimilados a Salarios', '606': 'Arrendamiento',
  '607': 'Régimen de Enajenación o Adquisición de Bienes', '608': 'Demás ingresos',
  '609': 'Consolidación', '610': 'Residentes en el Extranjero sin Establecimiento Permanente en México',
  '611': 'Ingresos por Dividendos (socios y accionistas)',
  '612': 'Personas Físicas con Actividades Empresariales y Profesionales', '614': 'Ingresos por intereses',
  '615': 'Régimen de los ingresos por obtención de premios', '616': 'Sin obligaciones fiscales',
  '620': 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos',
  '621': 'Incorporación Fiscal', '622': 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
  '623': 'Opcional para Grupos de Sociedades', '624': 'Coordinados',
  '625': 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
  '626': 'Régimen Simplificado de Confianza',
};
const C_USO_CFDI = {
  G01: 'Adquisición de mercancías', G02: 'Devoluciones, descuentos o bonificaciones',
  G03: 'Gastos en general', I01: 'Construcciones', I02: 'Mobiliario y equipo de oficina por inversiones',
  I03: 'Equipo de transporte', I04: 'Equipo de cómputo y accesorios',
  I05: 'Dados, troqueles, moldes, matrices y otros activos', I06: 'Comunicaciones telefónicas',
  I07: 'Comunicaciones satelitales', I08: 'Otra maquinaria y equipo',
  D01: 'Honorarios médicos, dentales y gastos hospitalarios',
  D02: 'Gastos médicos por incapacidad o discapacidad', D03: 'Gastos funerales', D04: 'Donativos',
  D05: 'Intereses reales pagados por créditos hipotecarios (casa habitación)',
  D06: 'Aportaciones voluntarias al SAR', D07: 'Primas por seguros de gastos médicos',
  D08: 'Gastos de transportación escolar obligatoria',
  D09: 'Depósitos en cuentas para el ahorro, pensiones', D10: 'Pagos por servicios educativos (colegiaturas)',
  S01: 'Sin efectos fiscales', CP01: 'Pagos', CN01: 'Nómina',
  P01: 'Por definir', // código usado en complementos de pago sobre CFDI 3.3 (previo a CP01)
};
const C_MONEDA = { MXN: 'Peso Mexicano', USD: 'Dólar Americano', EUR: 'Euro', XXX: 'Los códigos asignados para las transacciones en que intervenga ninguna moneda' };
const C_IMPUESTO = { '001': 'ISR', '002': 'IVA', '003': 'IEPS' };

const lbl = (dict, code) => (code ? (dict[code] || code) : '—');
// Convierte saltos de línea reales (frecuentes en descripciones de conceptos,
// ver decodeNumEntities) a <br> tras escapar — evita que se vean colapsados.
const escBr = (v) => esc(v).replace(/\n/g, '<br>');

// ── Cadena original TFD 1.1 (fórmula fija del SAT) y URL de verificación QR ──
function cadenaOriginalTfd({ uuid, fechaTimbrado, rfcProvCertif, selloCfd, noCertificadoSat }) {
  return `||1.1|${uuid}|${fechaTimbrado}|${rfcProvCertif}|${selloCfd}|${noCertificadoSat}||`;
}
function urlQrSat({ uuid, rfcEmisor, rfcReceptor, total, selloCfd }) {
  const fe = str(selloCfd).slice(-8);
  return 'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx' +
    `?id=${uuid}&re=${rfcEmisor}&rr=${rfcReceptor}&tt=${Number(total || 0).toFixed(6)}&fe=${fe}`;
}

// ── Impuestos de un nodo (Traslados/Retenciones) genérico ──
function listaImpuestos(node, trasladoTag, retencionTag) {
  const traslados = arr(node?.[trasladoTag.padre]?.[trasladoTag.hijo]).map((t) => ({
    impuesto: lbl(C_IMPUESTO, str(t['@_Impuesto'] || t['@_ImpuestoDR'] || t['@_ImpuestoP'])),
    base: t['@_Base'] ?? t['@_BaseDR'] ?? t['@_BaseP'],
    tipoFactor: t['@_TipoFactor'] ?? t['@_TipoFactorDR'] ?? t['@_TipoFactorP'],
    tasa: t['@_TasaOCuota'] ?? t['@_TasaOCuotaDR'] ?? t['@_TasaOCuotaP'],
    importe: t['@_Importe'] ?? t['@_ImporteDR'] ?? t['@_ImporteP'],
  }));
  const retenciones = retencionTag ? arr(node?.[retencionTag.padre]?.[retencionTag.hijo]).map((t) => ({
    impuesto: lbl(C_IMPUESTO, str(t['@_Impuesto'] || t['@_ImpuestoDR'] || t['@_ImpuestoP'])),
    base: t['@_Base'] ?? t['@_BaseDR'] ?? t['@_BaseP'],
    tipoFactor: t['@_TipoFactor'] ?? t['@_TipoFactorDR'] ?? t['@_TipoFactorP'],
    tasa: t['@_TasaOCuota'] ?? t['@_TasaOCuotaDR'] ?? t['@_TasaOCuotaP'],
    importe: t['@_Importe'] ?? t['@_ImporteDR'] ?? t['@_ImporteP'],
  })) : [];
  return { traslados, retenciones };
}

// ── Extrae del XML crudo todo lo necesario para el template ──
function extraerDatos(xml) {
  const root = parser.parse(xml);
  const c = root.Comprobante;
  if (!c) throw new Error('XML sin nodo Comprobante');
  const emisor = c.Emisor || {};
  const receptor = c.Receptor || {};
  const tfd = c.Complemento?.TimbreFiscalDigital || {};

  const uuid = (str(tfd['@_UUID']) || '').toUpperCase();
  const fechaTimbrado = str(tfd['@_FechaTimbrado']);
  const rfcProvCertif = str(tfd['@_RfcProvCertif']);
  const selloCfd = str(tfd['@_SelloCFD']);
  const noCertificadoSat = str(tfd['@_NoCertificadoSAT']);
  const total = c['@_Total'];
  const rfcEmisor = str(emisor['@_Rfc']);
  const rfcReceptor = str(receptor['@_Rfc']);

  const conceptos = arr(c.Conceptos?.Concepto).map((cn) => ({
    claveProdServ: str(cn['@_ClaveProdServ']),
    noIdentificacion: str(cn['@_NoIdentificacion']),
    cantidad: cn['@_Cantidad'],
    claveUnidad: str(cn['@_ClaveUnidad']),
    unidad: str(cn['@_Unidad']),
    descripcion: str(cn['@_Descripcion']),
    valorUnitario: cn['@_ValorUnitario'],
    importe: cn['@_Importe'],
    descuento: cn['@_Descuento'],
    objetoImp: lbl(C_OBJETO_IMP, str(cn['@_ObjetoImp'])),
    pedimento: arr(cn.InformacionAduanera).map((ia) => str(ia['@_NumeroPedimento'])).filter(Boolean).join(', '),
    cuentaPredial: str(cn.CuentaPredial?.['@_Numero']),
    ...listaImpuestos(cn.Impuestos, { padre: 'Traslados', hijo: 'Traslado' }, { padre: 'Retenciones', hijo: 'Retencion' }),
  }));

  const { traslados: trasladosHdr, retenciones: retencionesHdr } =
    listaImpuestos(c.Impuestos, { padre: 'Traslados', hijo: 'Traslado' }, { padre: 'Retenciones', hijo: 'Retencion' });

  // Complemento de pagos (tipo 'P')
  let pagos = null;
  const pagosComp = c.Complemento?.Pagos;
  if (pagosComp) {
    const totales = pagosComp.Totales || {};
    pagos = {
      version: str(pagosComp['@_Version']),
      totales: {
        retIva: totales['@_TotalRetencionesIVA'], retIsr: totales['@_TotalRetencionesISR'], retIeps: totales['@_TotalRetencionesIEPS'],
        baseIva16: totales['@_TotalTrasladosBaseIVA16'], impIva16: totales['@_TotalTrasladosImpuestoIVA16'],
        baseIva8: totales['@_TotalTrasladosBaseIVA8'], impIva8: totales['@_TotalTrasladosImpuestoIVA8'],
        baseIva0: totales['@_TotalTrasladosBaseIVA0'], impIva0: totales['@_TotalTrasladosImpuestoIVA0'],
        baseIvaExento: totales['@_TotalTrasladosBaseIVAExento'],
        montoTotal: totales['@_MontoTotalPagos'],
      },
      pagoList: arr(pagosComp.Pago).map((p) => ({
        fecha: str(p['@_FechaPago']),
        formaPago: lbl(C_FORMA_PAGO, str(p['@_FormaDePagoP'])),
        moneda: lbl(C_MONEDA, str(p['@_MonedaP'])),
        tipoCambio: p['@_TipoCambioP'],
        monto: p['@_Monto'],
        numOperacion: str(p['@_NumOperacion']),
        impuestosP: listaImpuestos(p.ImpuestosP, { padre: 'TrasladosP', hijo: 'TrasladoP' }, { padre: 'RetencionesP', hijo: 'RetencionP' }),
        documentos: arr(p.DoctoRelacionado).map((d) => ({
          idDocumento: str(d['@_IdDocumento']),
          serie: str(d['@_Serie']),
          folio: str(d['@_Folio']),
          moneda: lbl(C_MONEDA, str(d['@_MonedaDR'])),
          equivalencia: d['@_EquivalenciaDR'],
          numParcialidad: str(d['@_NumParcialidad']),
          impSaldoAnt: d['@_ImpSaldoAnt'],
          impPagado: d['@_ImpPagado'],
          impSaldoInsoluto: d['@_ImpSaldoInsoluto'],
          objetoImpDR: lbl(C_OBJETO_IMP, str(d['@_ObjetoImpDR'])),
          impuestosDR: listaImpuestos(d.ImpuestosDR, { padre: 'TrasladosDR', hijo: 'TrasladoDR' }, { padre: 'RetencionesDR', hijo: 'RetencionDR' }),
        })),
      })),
    };
  }

  const qrUrl = uuid ? urlQrSat({ uuid, rfcEmisor, rfcReceptor, total, selloCfd }) : null;
  const cadena = uuid ? cadenaOriginalTfd({ uuid, fechaTimbrado, rfcProvCertif, selloCfd, noCertificadoSat }) : null;

  return {
    uuid, folioFiscal: uuid,
    tipoComprobante: str(c['@_TipoDeComprobante']),
    version: str(c['@_Version']),
    serie: str(c['@_Serie']), folio: str(c['@_Folio']),
    fecha: str(c['@_Fecha']), fechaTimbrado,
    noCertificado: str(c['@_NoCertificado']),
    lugarExpedicion: str(c['@_LugarExpedicion']),
    exportacion: lbl(C_EXPORTACION, str(c['@_Exportacion'])),
    regimenEmisor: lbl(C_REGIMEN, str(emisor['@_RegimenFiscal'])),
    nombreEmisor: str(emisor['@_Nombre']), rfcEmisor,
    nombreReceptor: str(receptor['@_Nombre']), rfcReceptor,
    cpReceptor: str(receptor['@_DomicilioFiscalReceptor']),
    regimenReceptor: lbl(C_REGIMEN, str(receptor['@_RegimenFiscalReceptor'])),
    usoCfdi: lbl(C_USO_CFDI, str(receptor['@_UsoCFDI'])),
    moneda: lbl(C_MONEDA, str(c['@_Moneda'])),
    tipoCambio: c['@_TipoCambio'],
    formaPago: lbl(C_FORMA_PAGO, str(c['@_FormaPago'])),
    metodoPago: lbl(C_METODO_PAGO, str(c['@_MetodoPago'])),
    subtotal: c['@_SubTotal'], descuento: c['@_Descuento'], total,
    conceptos, trasladosHdr, retencionesHdr,
    pagos,
    selloCfd, selloSat: str(tfd['@_SelloSAT']),
    rfcProvCertif, fechaCertificacion: fechaTimbrado, noCertificadoSat,
    cadena, qrUrl,
  };
}

// ── HTML: bloque de impuestos (mini tabla) reutilizado en varios puntos ──
function tablaImpuestos(titulo, lista) {
  if (!lista.length) return '';
  return `
    <div class="bloque-titulo">${esc(titulo)}</div>
    <table class="tbl">
      <thead><tr><th>Base</th><th>Impuesto</th><th>Tipo Factor</th><th>Tasa o Cuota</th><th>Importe</th></tr></thead>
      <tbody>${lista.map((t) => `
        <tr>
          <td class="r">${fmt(t.base)}</td>
          <td class="c">${esc(t.impuesto)}</td>
          <td class="c">${esc(t.tipoFactor || 'Tasa')}</td>
          <td class="c">${t.tipoFactor === 'Cuota' ? fmt(t.tasa) : pct(t.tasa)}</td>
          <td class="r">${fmt(t.importe)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function conceptoHtml(cn, i) {
  const impConcepto = `
    <table class="tbl-imp">
      <thead><tr><th>Impuesto</th><th>Tipo</th><th>Base</th><th>Tipo Factor</th><th>Tasa o Cuota</th><th>Importe</th></tr></thead>
      <tbody>
        ${cn.traslados.map((t) => `<tr><td>${esc(t.impuesto)}</td><td>Traslado</td><td class="r">${fmt(t.base)}</td><td class="c">${esc(t.tipoFactor || 'Tasa')}</td><td class="c">${t.tipoFactor === 'Cuota' ? fmt(t.tasa) : pct(t.tasa)}</td><td class="r">${fmt(t.importe)}</td></tr>`).join('')}
        ${cn.retenciones.map((t) => `<tr><td>${esc(t.impuesto)}</td><td>Retención</td><td class="r">${fmt(t.base)}</td><td class="c">${esc(t.tipoFactor || 'Tasa')}</td><td class="c">${t.tipoFactor === 'Cuota' ? fmt(t.tasa) : pct(t.tasa)}</td><td class="r">${fmt(t.importe)}</td></tr>`).join('')}
        ${!cn.traslados.length && !cn.retenciones.length ? '<tr><td colspan="6" class="muted">Sin impuestos</td></tr>' : ''}
      </tbody>
    </table>`;

  return `
    <div class="concepto">
      <table class="tbl">
        <thead>
          <tr>
            <th>Clave del producto y/o servicio</th><th>No. identificación</th><th>Cantidad</th>
            <th>Clave de unidad</th><th>Unidad</th><th>Valor unitario</th><th>Importe</th>
            <th>Descuento</th><th>Objeto impuesto</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="c">${esc(cn.claveProdServ)}</td>
            <td class="c">${esc(cn.noIdentificacion) || '—'}</td>
            <td class="c">${esc(cn.cantidad)}</td>
            <td class="c">${esc(cn.claveUnidad)}</td>
            <td class="c">${esc(cn.unidad)}</td>
            <td class="r">${fmt(cn.valorUnitario)}</td>
            <td class="r">${fmt(cn.importe)}</td>
            <td class="r">${cn.descuento ? fmt(cn.descuento) : ''}</td>
            <td class="c">${esc(cn.objetoImp)}</td>
          </tr>
        </tbody>
      </table>
      <table class="tbl tbl-desc">
        <tbody>
          <tr>
            <td class="etq" style="width:90px">Descripción</td>
            <td>${escBr(cn.descripcion)}</td>
            <td style="width:340px;padding:0">${impConcepto}</td>
          </tr>
        </tbody>
      </table>
      <table class="tbl">
        <thead><tr><th>Número de pedimento</th><th>Número de cuenta predial</th></tr></thead>
        <tbody><tr><td class="c">${esc(cn.pedimento) || ''}</td><td class="c">${esc(cn.cuentaPredial) || ''}</td></tr></tbody>
      </table>
    </div>`;
}

function encabezadoHtml(d) {
  const campo = (label, value) => `<tr><td class="etq">${esc(label)}</td><td>${value}</td></tr>`;
  return `
    <table class="hdr">
      <tr>
        <td class="hdr-col">
          <table class="tbl-plano">
            ${campo('RFC emisor:', esc(d.rfcEmisor))}
            ${campo('Nombre emisor:', esc(d.nombreEmisor))}
            ${campo('Folio:', esc(d.folio) || '—')}
            ${campo('RFC receptor:', esc(d.rfcReceptor))}
            ${campo('Nombre receptor:', esc(d.nombreReceptor))}
            ${campo('Código postal del receptor:', esc(d.cpReceptor))}
            ${campo('Régimen fiscal receptor:', esc(d.regimenReceptor))}
            ${campo('Uso CFDI:', esc(d.usoCfdi))}
          </table>
        </td>
        <td class="hdr-col">
          <table class="tbl-plano">
            ${campo('Folio fiscal:', `<span class="mono">${esc(d.folioFiscal)}</span>`)}
            ${campo('No. de serie del CSD:', esc(d.noCertificado))}
            ${campo('Serie:', esc(d.serie) || '—')}
            ${campo('Código postal, fecha y hora de emisión:', `${esc(d.lugarExpedicion)} ${esc(fdt(d.fecha))}`)}
            ${campo('Efecto de comprobante:', esc(lbl(C_TIPO, d.tipoComprobante)))}
            ${campo('Régimen fiscal:', esc(d.regimenEmisor))}
            ${campo('Exportación:', esc(d.exportacion))}
          </table>
        </td>
      </tr>
    </table>`;
}

function sellosHtml(d) {
  const qrImg = d.qrDataUrl ? `<img src="${d.qrDataUrl}" class="qr" />` : '';
  return `
    <div class="page-break"></div>
    <div class="bloque-titulo">Sello digital del CFDI:</div>
    <p class="quiebre mono">${esc(d.selloCfd)}</p>
    <div class="bloque-titulo">Sello digital del SAT:</div>
    <p class="quiebre mono">${esc(d.selloSat)}</p>
    <table class="tbl-plano" style="margin-top:6px">
      <tr>
        <td style="width:170px;vertical-align:top">${qrImg}</td>
        <td style="vertical-align:top">
          <div class="bloque-titulo">Cadena Original del complemento de certificación digital del SAT:</div>
          <p class="quiebre mono">${esc(d.cadena)}</p>
          <table class="tbl-plano" style="margin-top:4px">
            <tr><td class="etq" style="width:220px">RFC del proveedor de certificación:</td><td>${esc(d.rfcProvCertif)}</td></tr>
            <tr><td class="etq">Fecha y hora de certificación:</td><td>${esc(fdt(d.fechaCertificacion))}</td></tr>
            <tr><td class="etq">No. de serie del certificado SAT:</td><td>${esc(d.noCertificadoSat)}</td></tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function seccionIngresoEgreso(d) {
  const conceptosHtml = d.conceptos.map(conceptoHtml).join('');
  return `
    <div class="bloque-titulo grande">Conceptos</div>
    ${conceptosHtml}
    <table class="tbl-plano final">
      <tr>
        <td style="width:50%;vertical-align:top">
          <table class="tbl-plano">
            <tr><td class="etq" style="width:110px">Moneda:</td><td>${esc(d.moneda)}</td></tr>
            <tr><td class="etq">Forma de pago:</td><td>${esc(d.formaPago)}</td></tr>
            <tr><td class="etq">Método de pago:</td><td>${esc(d.metodoPago)}</td></tr>
            <tr><td class="etq">Tipo de cambio:</td><td>${esc(d.tipoCambio) || '1'}</td></tr>
          </table>
        </td>
        <td style="vertical-align:top">
          <table class="tbl-plano totales">
            <tr><td class="etq r">Subtotal</td><td class="r">${fmt(d.subtotal)}</td></tr>
            ${Number(d.descuento) > 0 ? `<tr><td class="etq r">Descuento</td><td class="r">${fmt(d.descuento)}</td></tr>` : ''}
            ${d.trasladosHdr.map((t) => `<tr><td class="etq r">Impuestos trasladados ${esc(t.impuesto)} ${esc(pct(t.tasa))}</td><td class="r">${fmt(t.importe)}</td></tr>`).join('')}
            ${d.retencionesHdr.map((t) => `<tr><td class="etq r">Impuestos retenidos ${esc(t.impuesto)} ${esc(pct(t.tasa))}</td><td class="r">${fmt(t.importe)}</td></tr>`).join('')}
            <tr class="total-row"><td class="etq r">Total</td><td class="r">${fmt(d.total)}</td></tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function seccionPago(d) {
  const p = d.pagos;
  const conceptosHtml = d.conceptos.map(conceptoHtml).join('');
  const t = p.totales;
  const pagosHtml = p.pagoList.map((pago, i) => `
    <div class="bloque-titulo">Pago${p.pagoList.length > 1 ? ` ${i + 1}` : ''}</div>
    <table class="tbl">
      <thead><tr><th>Fecha</th><th>Forma de Pago</th><th>Moneda</th><th>Tipo de cambio</th><th>Monto</th><th>Número de operación</th></tr></thead>
      <tbody><tr>
        <td class="c">${esc(fdt(pago.fecha))}</td><td class="c">${esc(pago.formaPago)}</td>
        <td class="c">${esc(pago.moneda)}</td><td class="c">${esc(pago.tipoCambio) || '1'}</td>
        <td class="r">${fmt(pago.monto)}</td><td class="c">${esc(pago.numOperacion) || '—'}</td>
      </tr></tbody>
    </table>
    ${pago.documentos.map((doc) => `
      <div class="bloque-titulo">Documento Relacionado</div>
      <table class="tbl">
        <thead><tr><th>Identificador del documento</th><th>Serie</th><th>Folio</th><th>Moneda</th><th>Equivalencia DR</th><th>Número de parcialidad</th><th>Importe del saldo anterior</th></tr></thead>
        <tbody><tr>
          <td class="mono c" style="font-size:8px">${esc(doc.idDocumento)}</td>
          <td class="c">${esc(doc.serie) || '—'}</td><td class="c">${esc(doc.folio) || '—'}</td>
          <td class="c">${esc(doc.moneda)}</td><td class="c">${esc(doc.equivalencia) || '1'}</td>
          <td class="c">${esc(doc.numParcialidad)}</td><td class="r">${fmt(doc.impSaldoAnt)}</td>
        </tr></tbody>
      </table>
      <table class="tbl">
        <thead><tr><th>Importe pagado</th><th>Importe de saldo insoluto</th><th>Objeto de impuesto</th></tr></thead>
        <tbody><tr>
          <td class="r">${fmt(doc.impPagado)}</td><td class="r">${fmt(doc.impSaldoInsoluto)}</td><td class="c">${esc(doc.objetoImpDR)}</td>
        </tr></tbody>
      </table>
      ${tablaImpuestos('Impuestos del Documento Relacionado — Traslados', doc.impuestosDR.traslados)}
      ${tablaImpuestos('Impuestos del Documento Relacionado — Retenciones', doc.impuestosDR.retenciones)}
    `).join('')}
    ${tablaImpuestos('Impuestos del Pago — Traslados', pago.impuestosP.traslados)}
    ${tablaImpuestos('Impuestos del Pago — Retenciones', pago.impuestosP.retenciones)}
  `).join('');

  return `
    <div class="bloque-titulo grande">Conceptos</div>
    ${conceptosHtml}
    <table class="tbl-plano final">
      <tr>
        <td style="width:50%;vertical-align:top">
          <table class="tbl-plano"><tr><td class="etq" style="width:110px">Moneda:</td><td>${esc(d.moneda)}</td></tr></table>
        </td>
        <td style="vertical-align:top">
          <table class="tbl-plano totales">
            <tr><td class="etq r">Subtotal</td><td class="r">${fmt(d.subtotal)}</td></tr>
            <tr class="total-row"><td class="etq r">Total</td><td class="r">${fmt(d.total)}</td></tr>
          </table>
        </td>
      </tr>
    </table>

    <div class="bloque-titulo grande">Recepción de Pagos</div>
    <div class="bloque-titulo">Versión</div>
    <table class="tbl" style="width:120px"><tbody><tr><td class="c">${esc(p.version)}</td></tr></tbody></table>

    <div class="bloque-titulo">Totales</div>
    <table class="tbl">
      <thead><tr>
        <th>Total retenciones IVA</th><th>Total retenciones ISR</th><th>Total retenciones IEPS</th>
        <th>Total traslados base IVA 16%</th><th>Total traslados impuesto IVA 16%</th>
      </tr></thead>
      <tbody><tr>
        <td class="r">${t.retIva != null ? fmt(t.retIva) : ''}</td>
        <td class="r">${t.retIsr != null ? fmt(t.retIsr) : ''}</td>
        <td class="r">${t.retIeps != null ? fmt(t.retIeps) : ''}</td>
        <td class="r">${t.baseIva16 != null ? fmt(t.baseIva16) : ''}</td>
        <td class="r">${t.impIva16 != null ? fmt(t.impIva16) : ''}</td>
      </tr></tbody>
    </table>
    <table class="tbl">
      <thead><tr><th>Total traslados base IVA 8%</th><th>Total traslados impuesto IVA 8%</th><th>Total traslados base IVA 0%</th><th>Total traslados impuesto IVA 0%</th><th>Total traslados base IVA exento</th><th>Monto Total de Pagos</th></tr></thead>
      <tbody><tr>
        <td class="r">${t.baseIva8 != null ? fmt(t.baseIva8) : ''}</td>
        <td class="r">${t.impIva8 != null ? fmt(t.impIva8) : ''}</td>
        <td class="r">${t.baseIva0 != null ? fmt(t.baseIva0) : ''}</td>
        <td class="r">${t.impIva0 != null ? fmt(t.impIva0) : ''}</td>
        <td class="r">${t.baseIvaExento != null ? fmt(t.baseIvaExento) : ''}</td>
        <td class="r bold">${t.montoTotal != null ? fmt(t.montoTotal) : '—'}</td>
      </tr></tbody>
    </table>

    ${pagosHtml}`;
}

function buildHtml(d) {
  const esPago = d.tipoComprobante === 'P' && d.pagos;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 8.5px; color: #111; }
  .etq { font-weight: bold; white-space: nowrap; padding-right: 6px; }
  .mono { font-family: 'Courier New', monospace; word-break: break-all; }
  .c { text-align: center; } .r { text-align: right; } .bold { font-weight: bold; }
  .muted { color: #999; text-align: center; }
  table.tbl-plano { width: 100%; border-collapse: collapse; }
  table.tbl-plano td { padding: 2px 4px; vertical-align: top; font-size: 8.5px; }
  .hdr { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .hdr-col { width: 50%; vertical-align: top; padding: 0 8px 0 0; }
  .bloque-titulo { font-weight: bold; font-size: 10px; margin: 10px 0 4px; }
  .bloque-titulo.grande { font-size: 13px; margin-top: 14px; }
  table.tbl { width: 100%; border-collapse: collapse; margin-bottom: 4px; page-break-inside: avoid; }
  table.tbl th { background: #e8e8e8; border: 1px solid #ccc; padding: 3px 4px; font-size: 7.5px; text-align: center; }
  table.tbl td { border: 1px solid #ccc; padding: 3px 4px; font-size: 8px; }
  table.tbl-desc td { border: 1px solid #ccc; padding: 3px 4px; vertical-align: top; }
  table.tbl-imp { width: 100%; border-collapse: collapse; }
  table.tbl-imp th { background: #f2f2f2; border: 1px solid #ddd; padding: 2px 3px; font-size: 6.5px; }
  table.tbl-imp td { border: 1px solid #ddd; padding: 2px 3px; font-size: 7px; }
  .concepto { page-break-inside: avoid; margin-bottom: 6px; }
  .final { margin-top: 8px; }
  table.totales td { padding: 2px 4px; font-size: 9px; }
  .total-row td { border-top: 1.5px solid #333; font-weight: bold; font-size: 11px; padding-top: 4px; }
  .quiebre { font-size: 7px; line-height: 1.5; word-break: break-all; color: #333; margin-bottom: 6px; }
  .qr { width: 150px; height: 150px; }
  .page-break { page-break-before: always; }
  .footer-nota { text-align: center; font-weight: bold; font-size: 9px; margin-top: 16px; }
</style>
</head>
<body>
  ${encabezadoHtml(d)}
  ${esPago ? seccionPago(d) : seccionIngresoEgreso(d)}
  ${sellosHtml(d)}
  <p class="footer-nota">Este documento es una representación impresa de un CFDI</p>
</body>
</html>`;
}

/**
 * Genera el PDF del comprobante `id` (cfdi_repositorio.id). Lee el XML
 * crudo de disco (xml_path), lo parsea completo y renderiza con Puppeteer.
 * @returns {Promise<{buffer:Buffer, filename:string}>}
 */
async function generarPdfComprobante(id) {
  const [[row]] = await pool.query(
    'SELECT id, uuid, serie, folio, tipo_comprobante, xml_path FROM cfdi_repositorio WHERE id = ?', [id]);
  if (!row) { const e = new Error('Comprobante no encontrado'); e.status = 404; throw e; }
  if (!row.xml_path) { const e = new Error('Este comprobante no tiene el XML disponible localmente.'); e.status = 404; throw e; }

  const xmlFullPath = path.join(path.resolve(process.env.OUTPUT_DIR || './outputs'), row.xml_path);
  if (!fs.existsSync(xmlFullPath)) { const e = new Error('El archivo XML del comprobante no se encuentra en el servidor.'); e.status = 404; throw e; }
  const xml = fs.readFileSync(xmlFullPath, 'utf8');

  const d = extraerDatos(xml);
  if (d.qrUrl) d.qrDataUrl = await QRCode.toDataURL(d.qrUrl, { margin: 1, width: 300 });

  const html = buildHtml(d);
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote'],
  };
  if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;

  const browser = await puppeteer.launch(launchOptions);
  let buffer;
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().startsWith('data:') ? r.continue() : r.abort()));
    await page.setContent(html, { waitUntil: 'networkidle0' });
    buffer = await page.pdf({
      format: 'Letter',
      margin: { top: '10mm', bottom: '14mm', left: '10mm', right: '10mm' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="font-family:Arial,sans-serif;font-size:7.5px;color:#666;width:100%;
                    padding:2px 10mm 0;box-sizing:border-box;text-align:right;">
          Página <span class="pageNumber"></span> de <span class="totalPages"></span>
        </div>`,
    });
  } finally {
    await browser.close();
  }

  const nombre = [row.serie, row.folio].filter(Boolean).join('-') || row.uuid || `cfdi-${row.id}`;
  return { buffer, filename: `${nombre}.pdf` };
}

module.exports = { generarPdfComprobante };
