/**
 * Motor de pólizas — genera asientos de partida doble por periodo a partir de:
 *   1) cfdi_repositorio (ventas, compras/gastos, nómina, notas de crédito)
 *   2) inventario_movimientos tipo='salida' (costo de venta, método perpetuo)
 *
 * Reglas de negocio confirmadas con el usuario:
 *   - Mercancía (uso CFDI G01) → Inventario 115.01 (perpetuo); el costo de venta
 *     501.01←115.01 se reconoce desde las salidas de inventario.
 *   - PUE → directo por Banco (Santander); PPD → por cartera (Clientes/Proveedores).
 *   - Nómina → gasto Sueldos 601.01 contra Banco, deducciones a retenciones.
 *
 * Idempotente: borra las pólizas autogeneradas (origen cfdi/inventario) del periodo
 * y las reconstruye; las pólizas 'manual' se preservan.
 *
 * Limitaciones v1 (documentadas): no procesa complementos de pago (CFDI tipo P),
 * por lo que la cartera PPD no se salda automáticamente; el desglose de retenciones
 * (ISR/IVA) e ingresos/costos por producto se simplifica.
 */
const { pool } = require('../../config/db');
const { CTA, cuentaPorUsoCfdi, cuentaBanco } = require('./polizas.cuentas');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function boundsMes(anio, mes) {
  const a = Number(anio), m = Number(mes);
  const desde = `${a}-${String(m).padStart(2, '0')}-01`;
  const ultimo = new Date(a, m, 0).getDate();
  const hasta = `${a}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
  return { desde, hasta };
}

// Acumula movimientos no nulos y descarta los que quedan en 0.
function mov(cuenta, cargo, abono, concepto, entidad_tipo, entidad_id) {
  const c = r2(cargo), a = r2(abono);
  if (c === 0 && a === 0) return null;
  return { cuenta_codigo: cuenta, cargo: c, abono: a, concepto: concepto || null,
           entidad_tipo: entidad_tipo || null, entidad_id: entidad_id || null };
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
    "SELECT id, UPPER(TRIM(rfc)) rfc, cuenta_cobrar_codigo FROM clientes WHERE rfc IS NOT NULL AND rfc<>''");
  const [prov] = await pool.query(
    "SELECT id, UPPER(TRIM(rfc)) rfc, cuenta_pasivo_codigo, cuenta_gasto_codigo FROM proveedores WHERE rfc IS NOT NULL AND rfc<>''");
  const clientes = new Map(), proveedores = new Map();
  for (const c of cli) if (!clientes.has(c.rfc)) clientes.set(c.rfc, c);
  for (const p of prov) if (!proveedores.has(p.rfc)) proveedores.set(p.rfc, p);
  return { clientes, proveedores };
}

// ── Construcción por comprobante ──────────────────────────────────────────────
function polizaVenta(c, banco, cli) {
  const tc = Number(c.tipo_cambio) || 1;
  const ingreso = r2((Number(c.subtotal) - Number(c.descuento)) * tc);
  const iva     = r2(Number(c.total_impuestos_trasladados || 0) * tc);
  const ret     = r2(Number(c.total_impuestos_retenidos || 0) * tc);
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
      mov(ctaCobro, total, 0, 'Cobro/cartera', pue ? 'banco' : 'cliente', pue ? null : (cli && cli.id)),
      mov(CTA.ISR_A_FAVOR, ret, 0, 'Retención de clientes'),
      mov(CTA.INGRESOS, 0, ingreso, 'Ingreso por ventas'),
      mov(ctaIva, 0, iva, 'IVA trasladado'),
    ]);
}

function polizaNotaCreditoVenta(c, banco, cli) {
  const tc = Number(c.tipo_cambio) || 1;
  const ingreso = r2((Number(c.subtotal) - Number(c.descuento)) * tc);
  const iva     = r2(Number(c.total_impuestos_trasladados || 0) * tc);
  const ret     = r2(Number(c.total_impuestos_retenidos || 0) * tc);
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
      mov(ctaCobro, 0, total, 'Cartera/banco', pue ? 'banco' : 'cliente', pue ? null : (cli && cli.id)),
      mov(CTA.ISR_A_FAVOR, 0, ret, 'Retención (cancelación)'),
    ]);
}

function polizaCompra(c, banco, prov) {
  const tc = Number(c.tipo_cambio) || 1;
  const base  = r2((Number(c.subtotal) - Number(c.descuento)) * tc);
  const iva   = r2(Number(c.total_impuestos_trasladados || 0) * tc);
  const ret   = r2(Number(c.total_impuestos_retenidos || 0) * tc);
  const total = r2(Number(c.total) * tc);
  const pue   = (c.metodo_pago || '').toUpperCase() === 'PUE';
  const destino = cuentaPorUsoCfdi(c.uso_cfdi, prov && prov.cuenta_gasto_codigo);
  const ctaPago = pue ? banco : (prov && prov.cuenta_pasivo_codigo) || CTA.PROVEEDORES;
  const ctaIva  = pue ? CTA.IVA_ACRED_PAGADO : CTA.IVA_ACRED_PEND;
  const etq = destino.tipo === 'mercancia' ? 'Compra de mercancía' : 'Gasto';
  const ref = (c.serie || '') + (c.folio || '');
  return armar(
    { tipo: pue ? 'egreso' : 'diario', fecha: c.fecha, origen: 'cfdi', cfdi_id: c.id,
      cfdi_uuid: c.uuid, referencia: ref,
      concepto: `${etq} ${c.nombre_emisor || c.rfc_emisor || ''}`.trim() },
    [
      mov(destino.cuenta, base, 0, etq),
      mov(ctaIva, iva, 0, 'IVA acreditable'),
      mov(ctaPago, 0, total, 'Pago/cartera', pue ? 'banco' : 'proveedor', pue ? null : (prov && prov.id)),
      mov(CTA.RET_GENERICA, 0, ret, 'Retención a terceros'),
    ]);
}

function polizaNotaCreditoCompra(c, banco, prov) {
  const tc = Number(c.tipo_cambio) || 1;
  const base  = r2((Number(c.subtotal) - Number(c.descuento)) * tc);
  const iva   = r2(Number(c.total_impuestos_trasladados || 0) * tc);
  const ret   = r2(Number(c.total_impuestos_retenidos || 0) * tc);
  const total = r2(Number(c.total) * tc);
  const pue   = (c.metodo_pago || '').toUpperCase() === 'PUE';
  const destino = cuentaPorUsoCfdi(c.uso_cfdi, prov && prov.cuenta_gasto_codigo);
  const ctaPago = pue ? banco : (prov && prov.cuenta_pasivo_codigo) || CTA.PROVEEDORES;
  const ctaIva  = pue ? CTA.IVA_ACRED_PAGADO : CTA.IVA_ACRED_PEND;
  const ref = (c.serie || '') + (c.folio || '');
  return armar(
    { tipo: 'diario', fecha: c.fecha, origen: 'cfdi', cfdi_id: c.id, cfdi_uuid: c.uuid,
      referencia: ref, concepto: `Nota de crédito s/compra ${c.nombre_emisor || ''}`.trim() },
    [
      mov(ctaPago, total, 0, 'Cartera/banco', pue ? 'banco' : 'proveedor', pue ? null : (prov && prov.id)),
      mov(CTA.RET_GENERICA, ret, 0, 'Retención (cancelación)'),
      mov(destino.cuenta, 0, base, 'Devolución/descuento s/compras'),
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

// ── Generación del periodo ────────────────────────────────────────────────────
async function generarPeriodo({ anio, mes }, usuarioId = null) {
  if (!anio || !mes) { const e = new Error('anio y mes son obligatorios'); e.status = 400; throw e; }
  const { desde, hasta } = boundsMes(anio, mes);
  const banco = await cuentaBanco();
  const { clientes, proveedores } = await cargarMapas();

  const [cfdis] = await pool.query(
    `SELECT id, uuid, tipo, tipo_comprobante, serie, folio, fecha, rfc_emisor, nombre_emisor,
            rfc_receptor, nombre_receptor, uso_cfdi, metodo_pago, forma_pago, tipo_cambio,
            subtotal, descuento, total, total_impuestos_trasladados, total_impuestos_retenidos
       FROM cfdi_repositorio
      WHERE estatus='vigente' AND fecha >= ? AND fecha <= ?
        AND tipo_comprobante IN ('I','E','N')
      ORDER BY fecha, id`,
    [desde + ' 00:00:00', hasta + ' 23:59:59']);

  const polizas = [];
  for (const c of cfdis) {
    const rfcCli = (c.rfc_receptor || '').toUpperCase().trim();
    const rfcProv = (c.rfc_emisor || '').toUpperCase().trim();
    let p = null;
    if (c.tipo === 'emitido') {
      if (c.tipo_comprobante === 'I') p = polizaVenta(c, banco, clientes.get(rfcCli));
      else if (c.tipo_comprobante === 'E') p = polizaNotaCreditoVenta(c, banco, clientes.get(rfcCli));
      else if (c.tipo_comprobante === 'N') p = polizaNomina(c, banco);
    } else { // recibido
      if (c.tipo_comprobante === 'I') p = polizaCompra(c, banco, proveedores.get(rfcProv));
      else if (c.tipo_comprobante === 'E') p = polizaNotaCreditoCompra(c, banco, proveedores.get(rfcProv));
      // nómina recibida no aplica
    }
    if (p) polizas.push(p);
  }

  // Costo de venta del periodo (perpetuo) desde salidas de inventario.
  const [[cv]] = await pool.query(
    `SELECT COALESCE(SUM(cantidad * costo_unitario),0) costo, COUNT(*) n
       FROM inventario_movimientos
      WHERE tipo='salida' AND created_at >= ? AND created_at <= ?`,
    [desde + ' 00:00:00', hasta + ' 23:59:59']);
  const costo = r2(cv.costo);
  let costoPoliza = null;
  if (costo > 0) {
    costoPoliza = armar(
      { tipo: 'diario', fecha: hasta, origen: 'inventario', cfdi_id: null, cfdi_uuid: null,
        referencia: 'COSTO', concepto: `Costo de venta del periodo (${cv.n} salidas)` },
      [
        mov(CTA.COSTO_VENTA, costo, 0, 'Costo de venta'),
        mov(CTA.INVENTARIO, 0, costo, 'Salida de inventario'),
      ]);
    if (costoPoliza) polizas.push(costoPoliza);
  }

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
    costo_venta_inventario: costo,
    salidas_inventario: cv.n,
    total_cargos: cargos,
    total_abonos: abonos,
    cuadra: Math.abs(cargos - abonos) < 0.05,
  };
}

module.exports = { generarPeriodo, boundsMes };
