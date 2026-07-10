/**
 * legacy_cfdi_load.js — FASE 2 de la importación histórica de CFDI (corre en el VPS).
 *
 * Lee los JSON generados por legacy_cfdi_extract.js y los carga en
 * cfdi_repositorio / cfdi_repositorio_conceptos (origen='legacy'). Idempotente
 * por UUID (reutiliza cfdi.repo.guardarComprobante).
 *
 * Uso (en el VPS):  node scripts/legacy_cfdi_load.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { guardarComprobante } = require('../src/modules/cfdi/cfdi.repo');
const { pool } = require('../src/config/db');

const DIR = path.join(__dirname, '..', 'data', 'legacy_cfdi');
const RFC_PROPIO = (process.env.EMPRESA_RFC || 'RIC1903041Q2').toUpperCase();
const NOMBRE_PROPIO = process.env.EMPRESA_RAZON_SOCIAL || 'RODRICABR INNOVACION Y COMERCIO';

const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const s = (v) => { const t = v == null ? '' : String(v).trim(); return t === '' ? null : t; };
const n = (v) => (v == null || String(v).trim() === '' ? null : Number(v));
const uuid = (v) => (s(v) || '').toUpperCase() || null;

function headerToComprobante(row) {
  const rfcEmisor = (s(row.emisor_rfc) || '').toUpperCase();
  const tipo = rfcEmisor === RFC_PROPIO ? 'emitido' : 'recibido';
  const rfcReceptor = (s(row.receptor_rfc) || '').toUpperCase();
  return {
    uuid: uuid(row.uuid),
    tipo,
    tipo_comprobante: s(row.tipo_comprobante) || 'I',
    version: s(row.version_cfdi) || '4.0',
    serie: s(row.serie_emisor),
    folio: s(row.folio_interno_emisor),
    fecha: s(row.fecha_emision),
    fecha_timbrado: s(row.fecha_timbrado),
    rfc_emisor: rfcEmisor,
    nombre_emisor: s(row.nombre_emisor),
    regimen_fiscal_emisor: null,
    rfc_receptor: rfcReceptor,
    nombre_receptor: rfcReceptor === RFC_PROPIO ? NOMBRE_PROPIO : null,
    uso_cfdi: s(row.uso_cfdi),
    domicilio_fiscal_receptor: null,
    regimen_fiscal_receptor: null,
    lugar_expedicion: s(row.lugar_emision),
    metodo_pago: s(row.metodo_pago),
    forma_pago: s(row.forma_pago),
    condiciones_pago: s(row.plazo),
    moneda: s(row.moneda) || 'MXN',
    tipo_cambio: null,
    subtotal: n(row.subtotal) || 0,
    descuento: n(row.descuento) || 0,
    total: n(row.total) || 0,
    total_impuestos_trasladados: n(row.impuestos_trasladados),
    total_impuestos_retenidos: n(row.impuestos_retenidos),
    tipo_relacion: null,
    cfdi_relacionados: s(row.cfdi_relacionado),
    no_certificado: s(row.certificado),
    no_certificado_sat: s(row.certificado_sat),
    pac_rfc: s(row.rfc_pac),
    origen: 'legacy',
  };
}

function detalleToConcepto(row, i) {
  return {
    linea: n(row.renglon_factura) || i + 1,
    clave_prod_serv: s(row.clave_producto_servicio),
    no_identificacion: s(row.No_identificacion),
    cantidad: n(row.cantidad) || 0,
    clave_unidad: s(row.clave_unidad),
    unidad: s(row.unidad),
    descripcion: s(row.descripcion),
    valor_unitario: n(row.valor_unitario) || 0,
    importe: n(row.importe) || 0,
    descuento: 0,
    objeto_imp: null,
    base_iva: n(row.base_iva), tasa_iva: n(row.tasa_iva), importe_iva: n(row.importe_iva),
    base_ieps: n(row.base_ieps), tasa_ieps: n(row.tasa_ieps), importe_ieps: n(row.importe_ieps),
    base_isr: n(row.base_isr), tasa_isr: n(row.tasa_isr), importe_isr: n(row.importe_isr),
    codigo_interno: s(row.codigo_innovacom),
  };
}

// Agrupa filas de detalle por UUID.
function agruparDetalle(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const k = uuid(r.uuid);
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return map;
}

(async () => {
  if (!fs.existsSync(DIR)) { console.error('No existe', DIR, '— corre primero legacy_cfdi_extract.js en dev.'); process.exit(1); }

  const detEmit = agruparDetalle(read('cfdi_emitido_detalle.json'));
  const detRec = agruparDetalle(read('cfdi_recibido_detalle.json'));

  const grupos = [
    { file: 'cfdi_emitido.json', det: detEmit },
    { file: 'cfdi_recibido.json', det: detRec },
    { file: 'cfdi_pagos.json', det: new Map() }, // los pagos no tienen conceptos
  ];

  let insertados = 0, duplicados = 0, errores = 0, total = 0;
  for (const g of grupos) {
    if (!fs.existsSync(path.join(DIR, g.file))) { console.log('  (omitido, no existe)', g.file); continue; }
    const headers = read(g.file);
    console.log(`\nCargando ${g.file} (${headers.length}) ...`);
    for (let i = 0; i < headers.length; i++) {
      total++;
      const comp = headerToComprobante(headers[i]);
      if (!comp.uuid) { errores++; continue; }
      const conceptos = (g.det.get(comp.uuid) || []).map((r, j) => detalleToConcepto(r, j));
      try {
        const res = await guardarComprobante({ comprobante: comp, conceptos }, { origen: 'legacy', estatus: 'vigente' });
        if (res.inserted) insertados++; else duplicados++;
      } catch (e) { errores++; console.error('  err', comp.uuid, e.message); }
      if (total % 500 === 0) console.log(`  ... ${total} procesados`);
    }
  }
  console.log(`\nListo. Procesados ${total} | insertados ${insertados} | duplicados ${duplicados} | errores ${errores}`);
  await pool.end();
  process.exit(0);
})();
