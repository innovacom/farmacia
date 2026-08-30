/**
 * Motor de pólizas — genera asientos de partida doble por periodo a partir de:
 *   1) cfdi_repositorio (ventas, compras/gastos, nómina, notas de crédito, PAGOS)
 *   2) inventario_movimientos tipo='salida' (costo de venta, método perpetuo)
 *
 * Reglas de negocio confirmadas con el usuario:
 *   - Mercancía (uso CFDI G01) → Inventario 115.01 (perpetuo); el costo de venta
 *     501.01←115.01 se reconoce desde las salidas de inventario.
 *   - PUE → directo por Banco (Santander); PPD → por cartera (Clientes/Proveedores),
 *     que se salda con el complemento de pago (CFDI tipo P) cuando llega.
 *   - Nómina → gasto Sueldos 601.01 contra Banco, deducciones a retenciones.
 *
 * Idempotente: borra las pólizas autogeneradas (origen cfdi/inventario) del periodo
 * y las reconstruye; las pólizas 'manual' y 'apertura' se preservan.
 *
 * Limitaciones v2 (revisión 2026-08-24, ver Reporte Módulo Contable DISMED):
 *   - Complementos de pago (CFDI tipo P): SÍ se procesan (polizaPago). Requieren que
 *     el detalle por documento (cfdi_repositorio_pagos_doctos) exista; un pago sin ese
 *     detalle no genera póliza (no hay forma segura de saber a qué cartera aplica).
 *   - Retenciones ISR/IVA de ventas/compras: desglosadas cuando el XML trae el detalle
 *     por concepto (importe_isr / importe_iva_ret); si no, cae a una cuenta genérica
 *     de "otras retenciones" para no perder el cuadre.
 *   - Retenciones de nómina (ISR + IMSS) siguen en un solo monto global — desglosarlas
 *     requiere parsear el complemento de Nómina completo, fuera de este alcance.
 *   - Costo de venta depende 100% de que exista la salida en inventario_movimientos.
 */
const { pool } = require('../../config/db');
const { CTA, cuentaCompra, cuentaBanco, bancosComisionRfc } = require('./polizas.cuentas');
const { resolverAuxiliar, resolverDefault } = require('./cuentas.auxiliares');
const {
  metodoEjercicio, saldoInventarioPrevio, obtenerInventarioFinal,
} = require('./inventario.periodo');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function boundsMes(anio, mes) {
  const a = Number(anio), m = Number(mes);
  // Mes 13 = periodo de cierre del ejercicio (método periódico). No es un mes real:
  // no se procesa ningún CFDI y la póliza de ajuste se fecha al 31 de diciembre.
  if (m === 13) return { desde: `${a}-12-31`, hasta: `${a}-12-31` };
  const desde = `${a}-${String(m).padStart(2, '0')}-01`;
  const ultimo = new Date(a, m, 0).getDate();
  const hasta = `${a}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
  return { desde, hasta };
}

// Acumula movimientos no nulos y descarta los que quedan en 0. entidad_rfc/
// entidad_nombre son transitorios (no se guardan en polizas_movimientos, el
// INSERT solo toma columnas explícitas): los usa aplicarNivelDetalle() para
// identificar/crear el auxiliar aunque la entidad no esté en el catálogo de
// clientes/proveedores (ver migrate_v65 — el RFC es la llave real).
function mov(cuenta, cargo, abono, concepto, entidad_tipo, entidad_id, entidad_rfc, entidad_nombre) {
  const c = r2(cargo), a = r2(abono);
  if (c === 0 && a === 0) return null;
  return { cuenta_codigo: cuenta, cargo: c, abono: a, concepto: concepto || null,
           entidad_tipo: entidad_tipo || null, entidad_id: entidad_id || null,
           entidad_rfc: entidad_rfc || null, entidad_nombre: entidad_nombre || null };
}

/**
 * Construye una póliza balanceada a partir de movimientos (algunos pueden ser null).
 * Devuelve null si no hay movimientos con importe.
 */
function armar({ tipo, fecha, concepto, origen, cfdi_id, cfdi_uuid, referencia }, movimientos) {
  const movs = movimientos.filter(Boolean);
  if (!movs.length) return null;
  const total_cargos = r2(movs.reduce((s, m) => s + m.cargo, 0));
  const total_abonos = r2(movs.reduce((s, m) => s + m.abono, 0));
  return { tipo, fecha, concepto, origen, cfdi_id, cfdi_uuid, referencia,
           total_cargos, total_abonos, movs };
}

async function cargarMapas() {
  const [cli] = await pool.query(
    "SELECT id, UPPER(TRIM(rfc)) rfc, razon_social, cuenta_cobrar_codigo FROM clientes WHERE rfc IS NOT NULL AND rfc<>''");
  const [prov] = await pool.query(
    "SELECT id, UPPER(TRIM(rfc)) rfc, nombre_empresa, cuenta_pasivo_codigo, cuenta_gasto_codigo FROM proveedores WHERE rfc IS NOT NULL AND rfc<>''");
  const clientes = new Map(), proveedores = new Map();
  const clientesPorId = new Map(), proveedoresPorId = new Map();
  for (const c of cli) { if (!clientes.has(c.rfc)) clientes.set(c.rfc, c); clientesPorId.set(c.id, c); }
  for (const p of prov) { if (!proveedores.has(p.rfc)) proveedores.set(p.rfc, p); proveedoresPorId.set(p.id, p); }
  return { clientes, proveedores, clientesPorId, proveedoresPorId };
}

// Regla de negocio (2026-08-25): NINGUNA póliza queda contabilizada arriba de
// nivel 3 — toda subcuenta (nivel 2) usada en un movimiento se resuelve a un
// auxiliar antes de guardar. Dos caminos:
//   - Con entidad (cliente/proveedor, identificados por RFC — no por el id de
//     catálogo: así se crea auxiliar aunque la entidad no esté dada de alta
//     en el sistema, el RFC siempre viene en el CFDI) → auxiliar de esa
//     entidad (01, 02... el nombre del catálogo gana si hay match, si no cae
//     al nombre del XML). Se asigna en el primer movimiento y no se reasigna.
//   - Sin entidad (IVA, ingresos, gastos, banco, costo, etc.) → auxiliar
//     genérico ".00" de la subcuenta, con el mismo nombre que la subcuenta
//     (resolverDefault).
// Ya viene resuelto (2 puntos, nivel 3) → se deja igual, no se reprocesa.
async function aplicarNivelDetalle(polizas, clientesPorId, proveedoresPorId) {
  const cache = new Map();
  const nombresSubcuenta = new Map();
  for (const p of polizas) {
    for (const m of p.movs) {
      const puntos = (m.cuenta_codigo.match(/\./g) || []).length;
      if (puntos >= 2) continue; // ya es nivel 3

      if ((m.entidad_tipo === 'cliente' || m.entidad_tipo === 'proveedor') && m.entidad_rfc) {
        let nombreCatalogo = null;
        if (m.entidad_id) {
          nombreCatalogo = m.entidad_tipo === 'cliente'
            ? (clientesPorId.get(m.entidad_id) || {}).razon_social
            : (proveedoresPorId.get(m.entidad_id) || {}).nombre_empresa;
        }
        m.cuenta_codigo = await resolverAuxiliar(pool, {
          cuentaPadre: m.cuenta_codigo, entidadTipo: m.entidad_tipo, entidadId: m.entidad_id,
          rfc: m.entidad_rfc, nombre: nombreCatalogo || m.entidad_nombre,
        }, cache);
        continue;
      }

      if (puntos !== 1) continue; // nivel 1 (mayor) suelto: no debería pasar, se deja (defensivo)
      if (!nombresSubcuenta.has(m.cuenta_codigo)) {
        const [[row]] = await pool.query(
          'SELECT nombre FROM sat_cuentas_agrupador WHERE codigo=?', [m.cuenta_codigo]);
        nombresSubcuenta.set(m.cuenta_codigo, row ? row.nombre : m.cuenta_codigo);
      }
      m.cuenta_codigo = await resolverDefault(pool, m.cuenta_codigo, nombresSubcuenta.get(m.cuenta_codigo), cache);
    }
  }
}

// Desglosa la retención del encabezado en ISR / IVA (con detalle a nivel concepto,
// ya sumado en la consulta de generarPeriodo como ret_isr/ret_iva) y un residual
// "otras" para no perder cuadre cuando el detalle no alcanza al total del encabezado
// (CFDI viejos sin desglose por concepto, IEPS retenido, etc.).
function desgloseRetencion(c, tc) {
  const total = r2(Number(c.total_impuestos_retenidos || 0) * tc);
  const isr = r2(Number(c.ret_isr || 0) * tc);
  const iva = r2(Number(c.ret_iva || 0) * tc);
  const otras = r2(Math.max(0, total - isr - iva));
  return { total, isr, iva, otras };
}

// ── Construcción por comprobante ──────────────────────────────────────────────
function polizaVenta(c, banco, cli) {
  const tc = Number(c.tipo_cambio) || 1;
  const ingreso = r2((Number(c.subtotal) - Number(c.descuento)) * tc);
  const iva     = r2(Number(c.total_impuestos_trasladados || 0) * tc);
  const ret     = desgloseRetencion(c, tc);
  const total   = r2(Number(c.total) * tc);
  const pue     = (c.metodo_pago || '').toUpperCase() === 'PUE';
  const ctaCobro = pue ? banco : (cli && cli.cuenta_cobrar_codigo) || CTA.CLIENTES;
  const ctaIva   = pue ? CTA.IVA_TRAS_COBRADO : CTA.IVA_TRAS_NOCOBRADO;
  const ref = (c.serie || '') + (c.folio || '');
  return armar(
    { tipo: pue ? 'ingreso' : 'diario', fecha: c.fecha, origen: 'cfdi', cfdi_id: c.id,
      cfdi_uuid: c.uuid, referencia: ref,
      concepto: `Venta ${c.nombre_receptor || c.rfc_receptor || ''}`.trim() },
    [
      mov(ctaCobro, total, 0, 'Cobro/cartera', pue ? 'banco' : 'cliente', pue ? null : (cli && cli.id),
        pue ? null : c.rfc_receptor, pue ? null : c.nombre_receptor),
      mov(CTA.ISR_A_FAVOR, ret.isr, 0, 'ISR retenido por clientes'),
      mov(CTA.IVA_A_FAVOR, ret.iva, 0, 'IVA retenido por clientes'),
      mov(CTA.RET_GENERICA, ret.otras, 0, 'Otras retenciones de clientes (sin desglosar)'),
      mov(CTA.INGRESOS, 0, ingreso, 'Ingreso por ventas'),
      mov(ctaIva, 0, iva, 'IVA trasladado'),
    ]);
}

function polizaNotaCreditoVenta(c, banco, cli) {
  const tc = Number(c.tipo_cambio) || 1;
  const ingreso = r2((Number(c.subtotal) - Number(c.descuento)) * tc);
  const iva     = r2(Number(c.total_impuestos_trasladados || 0) * tc);
  const ret     = desgloseRetencion(c, tc);
  const total   = r2(Number(c.total) * tc);
  const pue     = (c.metodo_pago || '').toUpperCase() === 'PUE';
  const ctaCobro = pue ? banco : (cli && cli.cuenta_cobrar_codigo) || CTA.CLIENTES;
  const ctaIva   = pue ? CTA.IVA_TRAS_COBRADO : CTA.IVA_TRAS_NOCOBRADO;
  const ref = (c.serie || '') + (c.folio || '');
  return armar(
    { tipo: 'diario', fecha: c.fecha, origen: 'cfdi', cfdi_id: c.id, cfdi_uuid: c.uuid,
      referencia: ref, concepto: `Nota de crédito s/venta ${c.nombre_receptor || ''}`.trim() },
    [
      mov(CTA.INGRESOS, ingreso, 0, 'Devolución/descuento s/ventas'),
      mov(ctaIva, iva, 0, 'IVA trasladado (cancelación)'),
      mov(ctaCobro, 0, total, 'Cartera/banco', pue ? 'banco' : 'cliente', pue ? null : (cli && cli.id),
        pue ? null : c.rfc_receptor, pue ? null : c.nombre_receptor),
      mov(CTA.ISR_A_FAVOR, 0, ret.isr, 'ISR retenido (cancelación)'),
      mov(CTA.IVA_A_FAVOR, 0, ret.iva, 'IVA retenido (cancelación)'),
      mov(CTA.RET_GENERICA, 0, ret.otras, 'Otras retenciones (cancelación)'),
    ]);
}

function polizaCompra(c, banco, prov, bancosRfc) {
  const tc = Number(c.tipo_cambio) || 1;
  const base  = r2((Number(c.subtotal) - Number(c.descuento)) * tc);
  const iva   = r2(Number(c.total_impuestos_trasladados || 0) * tc);
  const ret   = desgloseRetencion(c, tc);
  const total = r2(Number(c.total) * tc);
  const pue   = (c.metodo_pago || '').toUpperCase() === 'PUE';
  const destino = cuentaCompra(c.uso_cfdi, prov && prov.cuenta_gasto_codigo, c.conceptos, c.rfc_emisor, bancosRfc);
  const ctaPago = pue ? banco : (prov && prov.cuenta_pasivo_codigo) || CTA.PROVEEDORES;
  const ctaIva  = pue ? CTA.IVA_ACRED_PAGADO : CTA.IVA_ACRED_PEND;
  const etq = destino.tipo === 'mercancia' ? 'Compra de mercancía'
    : destino.tipo === 'financiero' ? 'Comisión bancaria/financiera' : 'Gasto';
  // Comisión bancaria: el cargo también lleva la entidad (el banco emisor) para
  // que aterrice en SU auxiliar bajo 701.10 (ej. 701.10.04 BBVA), no en el
  // genérico 701.10.00 — así se distingue de qué banco es cada comisión.
  const esFinanciero = destino.tipo === 'financiero';
  const ref = (c.serie || '') + (c.folio || '');
  return armar(
    { tipo: pue ? 'egreso' : 'diario', fecha: c.fecha, origen: 'cfdi', cfdi_id: c.id,
      cfdi_uuid: c.uuid, referencia: ref,
      concepto: `${etq} ${c.nombre_emisor || c.rfc_emisor || ''}`.trim() },
    [
      mov(destino.cuenta, base, 0, etq, esFinanciero ? 'proveedor' : null, esFinanciero ? (prov && prov.id) : null,
        esFinanciero ? c.rfc_emisor : null, esFinanciero ? c.nombre_emisor : null),
      mov(ctaIva, iva, 0, 'IVA acreditable'),
      mov(ctaPago, 0, total, 'Pago/cartera', pue ? 'banco' : 'proveedor', pue ? null : (prov && prov.id),
        pue ? null : c.rfc_emisor, pue ? null : c.nombre_emisor),
      mov(CTA.RET_ISR_SERV, 0, ret.isr, 'ISR retenido a terceros'),
      mov(CTA.RET_IVA, 0, ret.iva, 'IVA retenido a terceros'),
      mov(CTA.RET_GENERICA, 0, ret.otras, 'Otras retenciones a terceros (sin desglosar)'),
    ]);
}

function polizaNotaCreditoCompra(c, banco, prov, bancosRfc) {
  const tc = Number(c.tipo_cambio) || 1;
  const base  = r2((Number(c.subtotal) - Number(c.descuento)) * tc);
  const iva   = r2(Number(c.total_impuestos_trasladados || 0) * tc);
  const ret   = desgloseRetencion(c, tc);
  const total = r2(Number(c.total) * tc);
  const pue   = (c.metodo_pago || '').toUpperCase() === 'PUE';
  const destino = cuentaCompra(c.uso_cfdi, prov && prov.cuenta_gasto_codigo, c.conceptos, c.rfc_emisor, bancosRfc);
  const ctaPago = pue ? banco : (prov && prov.cuenta_pasivo_codigo) || CTA.PROVEEDORES;
  const ctaIva  = pue ? CTA.IVA_ACRED_PAGADO : CTA.IVA_ACRED_PEND;
  const esFinanciero = destino.tipo === 'financiero';
  const ref = (c.serie || '') + (c.folio || '');
  return armar(
    { tipo: 'diario', fecha: c.fecha, origen: 'cfdi', cfdi_id: c.id, cfdi_uuid: c.uuid,
      referencia: ref, concepto: `Nota de crédito s/compra ${c.nombre_emisor || ''}`.trim() },
    [
      mov(ctaPago, total, 0, 'Cartera/banco', pue ? 'banco' : 'proveedor', pue ? null : (prov && prov.id),
        pue ? null : c.rfc_emisor, pue ? null : c.nombre_emisor),
      mov(CTA.RET_ISR_SERV, ret.isr, 0, 'ISR retenido (cancelación)'),
      mov(CTA.RET_IVA, ret.iva, 0, 'IVA retenido (cancelación)'),
      mov(CTA.RET_GENERICA, ret.otras, 0, 'Otras retenciones (cancelación)'),
      mov(destino.cuenta, 0, base, 'Devolución/descuento s/compras', esFinanciero ? 'proveedor' : null,
        esFinanciero ? (prov && prov.id) : null, esFinanciero ? c.rfc_emisor : null, esFinanciero ? c.nombre_emisor : null),
      mov(ctaIva, 0, iva, 'IVA acreditable (cancelación)'),
    ]);
}

function polizaNomina(c, banco) {
  const tc = Number(c.tipo_cambio) || 1;
  const bruto = r2(Number(c.subtotal) * tc);
  const deduc = r2(Number(c.descuento) * tc);
  const neto  = r2(Number(c.total) * tc);
  const ref = (c.serie || '') + (c.folio || '');
  return armar(
    { tipo: 'egreso', fecha: c.fecha, origen: 'cfdi', cfdi_id: c.id, cfdi_uuid: c.uuid,
      referencia: ref, concepto: `Nómina ${c.nombre_receptor || ''}`.trim() },
    [
      mov(CTA.SUELDOS, bruto, 0, 'Sueldos y salarios (percepciones)'),
      mov(CTA.RET_ISR_SUELDOS, 0, deduc, 'Deducciones de nómina (ISR/IMSS)'),
      mov(banco, 0, neto, 'Pago de nómina', 'banco'),
    ]);
}

// ── Complemento de pago (CFDI tipo P) ───────────────────────────────────────
// Salda la cartera PPD generada por polizaVenta/polizaCompra y reclasifica el IVA
// de "pendiente" a "cobrado/pagado" por lo efectivamente liquidado.
async function documentosPago(pagoId) {
  const [rows] = await pool.query(
    `SELECT uuid_documento, imp_pagado, importe_iva_dr
       FROM cfdi_repositorio_pagos_doctos WHERE pago_id = ?`, [pagoId]);
  return rows;
}

async function facturaPorUuid(uuid) {
  const [rows] = await pool.query(
    `SELECT total, total_impuestos_trasladados FROM cfdi_repositorio WHERE uuid = ? LIMIT 1`,
    [uuid]);
  return rows[0] || null;
}

async function polizaPago(c, banco, clientes, proveedores) {
  const tc = Number(c.tipo_cambio) || 1;
  const docs = await documentosPago(c.id);
  // Sin detalle por documento no hay forma segura de saber a qué cartera aplica
  // (no se genera póliza; el pago queda pendiente hasta que el detalle exista).
  if (!docs.length) return null;

  const esCobro = c.tipo === 'emitido'; // lo emitimos nosotros → documenta que NOS pagaron
  const rfcContraparte = ((esCobro ? c.rfc_receptor : c.rfc_emisor) || '').toUpperCase().trim();
  const entidad = esCobro ? clientes.get(rfcContraparte) : proveedores.get(rfcContraparte);
  const ctaCartera = esCobro
    ? (entidad && entidad.cuenta_cobrar_codigo) || CTA.CLIENTES
    : (entidad && entidad.cuenta_pasivo_codigo) || CTA.PROVEEDORES;

  let aplicado = 0, ivaAplicado = 0;
  for (const d of docs) {
    const impPagado = Number(d.imp_pagado) || 0;
    aplicado += impPagado;
    if (d.importe_iva_dr != null) {
      ivaAplicado += Number(d.importe_iva_dr);
    } else {
      // Sin ImpuestosDR en el XML: prorratea el IVA de la factura por lo pagado.
      const f = await facturaPorUuid(d.uuid_documento);
      if (f && Number(f.total) > 0) {
        ivaAplicado += (impPagado / Number(f.total)) * Number(f.total_impuestos_trasladados || 0);
      }
    }
  }
  // Se usa lo aplicado a documentos (no el total del encabezado) como monto de la
  // póliza: así siempre cuadra aunque el pago no logre matchear el 100% del monto
  // (p.ej. documento relacionado de un ejercicio no cargado en el repositorio).
  aplicado = r2(aplicado * tc);
  ivaAplicado = r2(ivaAplicado * tc);
  if (!aplicado) return null;

  const ctaIvaPend = esCobro ? CTA.IVA_TRAS_NOCOBRADO : CTA.IVA_ACRED_PEND;
  const ctaIvaReal = esCobro ? CTA.IVA_TRAS_COBRADO : CTA.IVA_ACRED_PAGADO;
  const nombreContraparte = esCobro
    ? (c.nombre_receptor || c.rfc_receptor || '')
    : (c.nombre_emisor || c.rfc_emisor || '');
  const ref = (c.serie || '') + (c.folio || '');

  const movs = esCobro ? [
    mov(banco, aplicado, 0, 'Cobro recibido', 'banco'),
    mov(ctaCartera, 0, aplicado, 'Aplicación a cartera de clientes', 'cliente', entidad && entidad.id,
      rfcContraparte, nombreContraparte),
    mov(ctaIvaPend, ivaAplicado, 0, 'IVA trasladado: reclasifica pendiente→cobrado'),
    mov(ctaIvaReal, 0, ivaAplicado, 'IVA trasladado cobrado'),
  ] : [
    mov(ctaCartera, aplicado, 0, 'Aplicación a cartera de proveedores', 'proveedor', entidad && entidad.id,
      rfcContraparte, nombreContraparte),
    mov(ctaIvaReal, ivaAplicado, 0, 'IVA acreditable pagado'),
    mov(ctaIvaPend, 0, ivaAplicado, 'IVA acreditable: reclasifica pendiente→pagado'),
    mov(banco, 0, aplicado, 'Pago realizado', 'banco'),
  ];

  return armar(
    { tipo: esCobro ? 'ingreso' : 'egreso', fecha: c.fecha, origen: 'cfdi', cfdi_id: c.id,
      cfdi_uuid: c.uuid, referencia: ref,
      concepto: `${esCobro ? 'Cobro' : 'Pago'} ${nombreContraparte}`.trim() },
    movs);
}

// ── Generación del periodo ────────────────────────────────────────────────────
async function generarPeriodo({ anio, mes }, usuarioId = null) {
  if (!anio || !mes) { const e = new Error('anio y mes son obligatorios'); e.status = 400; throw e; }
  const { desde, hasta } = boundsMes(anio, mes);
  const banco = await cuentaBanco();
  const { clientes, proveedores, clientesPorId, proveedoresPorId } = await cargarMapas();
  const bancosRfc = await bancosComisionRfc();

  const esCierre = Number(mes) === 13;

  // Mes 13 (cierre del ejercicio): no cae ningún CFDI en ese periodo; solo se arma el
  // asiento de ajuste de inventario más abajo.
  let cfdis = [];
  if (!esCierre) {
    [cfdis] = await pool.query(
    `SELECT c.id, c.uuid, c.tipo, c.tipo_comprobante, c.serie, c.folio, c.fecha,
            c.rfc_emisor, c.nombre_emisor, c.rfc_receptor, c.nombre_receptor, c.uso_cfdi,
            c.metodo_pago, c.forma_pago, c.tipo_cambio, c.subtotal, c.descuento, c.total,
            c.total_impuestos_trasladados, c.total_impuestos_retenidos,
            (SELECT COALESCE(SUM(importe_isr),0) FROM cfdi_repositorio_conceptos
              WHERE comprobante_id = c.id) AS ret_isr,
            (SELECT COALESCE(SUM(importe_iva_ret),0) FROM cfdi_repositorio_conceptos
              WHERE comprobante_id = c.id) AS ret_iva,
            (SELECT GROUP_CONCAT(descripcion SEPARATOR ' | ') FROM cfdi_repositorio_conceptos
              WHERE comprobante_id = c.id) AS conceptos
       FROM cfdi_repositorio c
      WHERE c.estatus='vigente' AND c.fecha >= ? AND c.fecha <= ?
        AND c.tipo_comprobante IN ('I','E','N','P')
      ORDER BY c.fecha, c.id`,
      [desde + ' 00:00:00', hasta + ' 23:59:59']);
  }

  const polizas = [];
  for (const c of cfdis) {
    const rfcCli = (c.rfc_receptor || '').toUpperCase().trim();
    const rfcProv = (c.rfc_emisor || '').toUpperCase().trim();
    let p = null;
    if (c.tipo_comprobante === 'P') {
      p = await polizaPago(c, banco, clientes, proveedores);
    } else if (c.tipo === 'emitido') {
      if (c.tipo_comprobante === 'I') p = polizaVenta(c, banco, clientes.get(rfcCli));
      else if (c.tipo_comprobante === 'E') p = polizaNotaCreditoVenta(c, banco, clientes.get(rfcCli));
      else if (c.tipo_comprobante === 'N') p = polizaNomina(c, banco);
    } else { // recibido
      if (c.tipo_comprobante === 'I') p = polizaCompra(c, banco, proveedores.get(rfcProv), bancosRfc);
      else if (c.tipo_comprobante === 'E') p = polizaNotaCreditoCompra(c, banco, proveedores.get(rfcProv), bancosRfc);
      // nómina recibida no aplica
    }
    if (p) polizas.push(p);
  }

  // ── Costo de ventas según el método del ejercicio (contabilidad_ejercicio) ──
  //   perpetuo  → Σ salidas del kardex (comportamiento histórico)
  //   periodico → saldo previo de 115 + movimiento del periodo a 115 − inventario final
  //   compras   → costo = movimiento del periodo a 115 (caso IF ≡ II del periódico)
  const metodo = await metodoEjercicio(anio);
  const costeo = { metodo_inventario: metodo, costo_venta: 0 };

  if (metodo === 'perpetuo') {
    // registrarSalida (inventario/movimientos.service.js) guarda `cantidad` en NEGATIVO
    // para tipo='salida'; el ABS() lo devuelve positivo. BUG del 2026-08-24: sin ABS()
    // `costo` siempre salía negativo y `if (costo > 0)` nunca se cumplía.
    const [[cv]] = await pool.query(
      `SELECT COALESCE(SUM(ABS(cantidad) * costo_unitario),0) costo, COUNT(*) n
         FROM inventario_movimientos
        WHERE tipo='salida' AND created_at >= ? AND created_at <= ?`,
      [desde + ' 00:00:00', hasta + ' 23:59:59']);
    const costo = r2(cv.costo);
    if (costo > 0) {
      const cp = armar(
        { tipo: 'diario', fecha: hasta, origen: 'inventario', cfdi_id: null, cfdi_uuid: null,
          referencia: 'COSTO', concepto: `Costo de venta del periodo (${cv.n} salidas)` },
        [
          mov(CTA.COSTO_VENTA, costo, 0, 'Costo de venta'),
          mov(CTA.INVENTARIO, 0, costo, 'Salida de inventario'),
        ]);
      if (cp) polizas.push(cp);
    }

    // Ajustes físicos (merma/sobrante). SOLO en perpetuo: en periódico la diferencia
    // física ya queda absorbida en II + Compras − IF y postearla aparte la contaría dos veces.
    const [[aj]] = await pool.query(
      `SELECT COALESCE(SUM(cantidad * costo_unitario),0) neto, COUNT(*) n
         FROM inventario_movimientos
        WHERE tipo='ajuste' AND created_at >= ? AND created_at <= ?`,
      [desde + ' 00:00:00', hasta + ' 23:59:59']);
    const ajusteNeto = r2(aj.neto);
    let ajustePoliza = null;
    if (ajusteNeto < 0) {
      ajustePoliza = armar(
        { tipo: 'diario', fecha: hasta, origen: 'inventario', cfdi_id: null, cfdi_uuid: null,
          referencia: 'MERMA', concepto: `Merma neta de inventario por ajustes físicos del periodo (${aj.n} ajustes)` },
        [
          mov(CTA.GASTOS, -ajusteNeto, 0, 'Merma de inventario (ajuste físico)'),
          mov(CTA.INVENTARIO, 0, -ajusteNeto, 'Salida de inventario por merma'),
        ]);
    } else if (ajusteNeto > 0) {
      ajustePoliza = armar(
        { tipo: 'diario', fecha: hasta, origen: 'inventario', cfdi_id: null, cfdi_uuid: null,
          referencia: 'SOBRANTE', concepto: `Sobrante neto de inventario por ajustes físicos del periodo (${aj.n} ajustes)` },
        [
          mov(CTA.INVENTARIO, ajusteNeto, 0, 'Entrada de inventario por sobrante'),
          mov(CTA.OTROS_INGRESOS, 0, ajusteNeto, 'Sobrante de inventario (ajuste físico)'),
        ]);
    }
    if (ajustePoliza) polizas.push(ajustePoliza);

    costeo.costo_venta = costo;
    costeo.salidas_inventario = cv.n;
    costeo.ajuste_inventario_neto = ajusteNeto;
    costeo.ajustes_inventario = aj.n;
  } else {
    // Movimiento del periodo a 115 = pólizas CFDI recién armadas EN MEMORIA (cuenta
    // 115.01, antes de aplicarNivelDetalle) + pólizas manuales YA guardadas en este
    // mismo periodo (el DELETE de la persistencia solo toca cfdi/inventario, así que
    // esas sobreviven y su movimiento a 115 es real). La apertura no cuenta aquí: ya
    // va en el saldo previo (saldoInventarioPrevio la trata como previa por su origen).
    const mov115mem = polizas.reduce((s, p) => s + p.movs
      .filter((m) => m && String(m.cuenta_codigo).startsWith('115.01'))
      .reduce((ss, m) => ss + (m.cargo - m.abono), 0), 0);
    const [[m115db]] = await pool.query(
      `SELECT COALESCE(SUM(mv.cargo - mv.abono),0) s
         FROM polizas_movimientos mv JOIN polizas p ON p.id = mv.poliza_id
        WHERE (mv.cuenta_codigo = '115.01' OR mv.cuenta_codigo LIKE '115.01.%')
          AND p.periodo_anio = ? AND p.periodo_mes = ?
          AND p.origen NOT IN ('cfdi','inventario','apertura')`,
      [anio, mes]);
    const mov115 = r2(mov115mem + Number(m115db.s));
    const saldoPrevio = await saldoInventarioPrevio(anio, mes);

    let invFinal, invFinalOrigen, invFinalSugerido = false;
    if (metodo === 'compras') {
      invFinal = saldoPrevio;            // IF ≡ II ⟹ costo = movimiento del periodo a 115
      invFinalOrigen = 'compras';
    } else {
      const info = await obtenerInventarioFinal(anio, mes);
      invFinal = info.inventario_final;
      invFinalOrigen = info.origen;
      invFinalSugerido = !!info.sugerido;
    }

    const costo = r2(saldoPrevio + mov115 - invFinal);
    if (Math.abs(costo) >= 0.005) {
      const ref = esCierre ? 'CIERRE' : 'COSTO';
      const concepto = esCierre
        ? 'Ajuste de cierre del ejercicio: costo de ventas contra inventario físico'
        : `Costo de ventas del periodo (método ${metodo})`;
      const movs = costo >= 0
        ? [
            mov(CTA.COSTO_VENTA, costo, 0, 'Costo de ventas'),
            mov(CTA.INVENTARIO, 0, costo, 'Baja de inventario a costo de ventas'),
          ]
        : [
            mov(CTA.INVENTARIO, -costo, 0, 'Alta de inventario (inventario final > II + compras)'),
            mov(CTA.COSTO_VENTA, 0, -costo, 'Costo de ventas (ajuste en negativo)'),
          ];
      const cp = armar(
        { tipo: 'diario', fecha: hasta, origen: 'inventario', cfdi_id: null, cfdi_uuid: null,
          referencia: ref, concepto }, movs);
      if (cp) polizas.push(cp);
    }

    costeo.costo_venta = costo;
    costeo.saldo_inventario_previo = saldoPrevio;
    costeo.compras_periodo = mov115;
    costeo.inventario_final = invFinal;
    costeo.inventario_final_origen = invFinalOrigen;
    costeo.inventario_final_sugerido = invFinalSugerido;
  }

  // Nivel 3: ningún movimiento queda arriba de nivel 3 (ver aplicarNivelDetalle).
  await aplicarNivelDetalle(polizas, clientesPorId, proveedoresPorId);

  // ── Persistencia transaccional: borra autogeneradas y reinserta ─────────────
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "DELETE FROM polizas WHERE periodo_anio=? AND periodo_mes=? AND origen IN ('cfdi','inventario')",
      [anio, mes]);

    for (const p of polizas) {
      const [res] = await conn.query(
        `INSERT INTO polizas
           (tipo, fecha, periodo_anio, periodo_mes, concepto, origen, cfdi_id, cfdi_uuid,
            referencia, total_cargos, total_abonos, usuario_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [p.tipo, p.fecha, anio, mes, p.concepto, p.origen, p.cfdi_id, p.cfdi_uuid,
         p.referencia, p.total_cargos, p.total_abonos, usuarioId]);
      const pid = res.insertId;
      const values = p.movs.map((m) => [pid, m.cuenta_codigo, m.cargo, m.abono, m.concepto,
                                        m.entidad_tipo, m.entidad_id]);
      if (values.length) {
        await conn.query(
          `INSERT INTO polizas_movimientos
             (poliza_id, cuenta_codigo, cargo, abono, concepto, entidad_tipo, entidad_id)
           VALUES ?`, [values]);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const cargos = r2(polizas.reduce((s, p) => s + p.total_cargos, 0));
  const abonos = r2(polizas.reduce((s, p) => s + p.total_abonos, 0));
  return {
    anio: Number(anio), mes: Number(mes), periodo: { desde, hasta },
    banco_cuenta: banco,
    generadas: polizas.length,
    cfdis_procesados: cfdis.length,
    // Claves legacy que la UI ya leía — válidas tal cual en perpetuo, 0 en los demás métodos.
    costo_venta_inventario: r2(costeo.costo_venta),
    salidas_inventario: costeo.salidas_inventario || 0,
    ajuste_inventario_neto: costeo.ajuste_inventario_neto || 0,
    ajustes_inventario: costeo.ajustes_inventario || 0,
    ...costeo,
    total_cargos: cargos,
    total_abonos: abonos,
    cuadra: Math.abs(cargos - abonos) < 0.05,
  };
}

module.exports = { generarPeriodo, boundsMes };
