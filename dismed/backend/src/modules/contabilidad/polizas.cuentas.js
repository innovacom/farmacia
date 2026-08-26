/**
 * Cuentas del Código Agrupador SAT usadas por el motor de pólizas.
 *
 * Las cuentas "de sistema" (IVA, retenciones, resultado) son códigos estables del
 * Anexo 24 y se fijan aquí. Las cuentas "de entidad" (cliente, proveedor, gasto,
 * costo, banco) tienen un valor por defecto aquí pero pueden venir sobre-escritas
 * por el registro correspondiente:
 *   - clientes.cuenta_cobrar_codigo
 *   - proveedores.cuenta_pasivo_codigo / cuenta_gasto_codigo
 *   - productos.cuenta_ingreso_codigo / cuenta_costo_codigo
 *   - bancos.cuenta_contable_codigo  (banco predeterminado)
 */
const { pool } = require('../../config/db');

const CTA = {
  // Activo
  BANCO:              '102.01', // Bancos nacionales (Santander) — se resuelve dinámico
  CLIENTES:           '105.01', // Clientes nacionales
  ISR_A_FAVOR:        '113.02', // ISR a favor (retenido por clientes)
  IVA_A_FAVOR:        '113.01', // IVA a favor (retenido por clientes)
  INVENTARIO:         '115.01', // Inventario (mercancía)
  IVA_ACRED_PAGADO:   '118.01', // IVA acreditable pagado (compras PUE)
  IVA_ACRED_PEND:     '119.01', // IVA pendiente de pago (compras PPD)
  // Pasivo
  PROVEEDORES:        '201.01', // Proveedores nacionales
  IVA_TRAS_COBRADO:   '208.01', // IVA trasladado cobrado (ventas PUE)
  IVA_TRAS_NOCOBRADO: '209.01', // IVA trasladado no cobrado (ventas PPD)
  PROV_SUELDOS:       '210.01', // Provisión de sueldos por pagar (no usado por defecto)
  RET_ISR_SUELDOS:    '216.01', // ISR retenido por sueldos (nómina)
  RET_ISR_SERV:       '216.04', // ISR retenido por servicios profesionales
  RET_IVA:            '216.10', // IVA retenido
  RET_GENERICA:       '216.12', // Otras impuestos retenidos (residual sin desglosar)
  // Capital
  RESULTADO:          '305',    // Resultado del ejercicio (solo se usa para mostrar el
                                 // Balance General, nunca se postea a polizas_movimientos)
  // Ingresos / Costos / Gastos
  INGRESOS:           '401.01', // Ventas y/o servicios gravados a la tasa general
  OTROS_INGRESOS:     '403.01', // Otros ingresos (p. ej. sobrante de inventario en ajuste físico)
  COSTO_VENTA:        '501.01', // Costo de venta
  GASTOS:             '601.84', // Otros gastos generales (default de gasto; también merma de inventario)
  SUELDOS:            '601.01', // Sueldos y salarios
  COMISIONES_BANCARIAS: '701.10', // Comisiones bancarias (ver cuentaCompra)
};

/**
 * Mapea el uso CFDI de un comprobante recibido a la cuenta de cargo.
 * G01 = mercancía (inventario); I01-I08 = activo fijo; el resto = gasto.
 * Devuelve { tipo: 'mercancia'|'gasto'|'activo', cuenta }.
 */
function cuentaPorUsoCfdi(uso, cuentaGastoProveedor) {
  const u = (uso || '').toUpperCase();
  if (u === 'G01') return { tipo: 'mercancia', cuenta: CTA.INVENTARIO };
  if (/^I0[1-8]$/.test(u)) return { tipo: 'activo', cuenta: cuentaGastoProveedor || CTA.GASTOS };
  // G03 gastos en general, P01 por definir, vacío, etc. → gasto del proveedor o 601.84
  return { tipo: 'gasto', cuenta: cuentaGastoProveedor || CTA.GASTOS };
}

/**
 * RFC de instituciones bancarias que SÍ le han facturado a DISMED, tomados de
 * `bancos.rfc` — NO hardcodeados. El catálogo `bancos` (migrate_v20, fuente
 * SAT/Banxico "Instituciones bancarias participantes SPEI") no trae RFC de
 * origen; `scripts/cruzar_rfc_bancos.js` lo cruza contra los RFC REALES de
 * `cfdi_repositorio` (autoritativos, validados por el PAC/SAT al timbrar) y
 * los guarda ahí. Cualquier banco nuevo se agrega recargando ese cruce — no
 * hay que tocar código.
 */
async function bancosComisionRfc() {
  const [rows] = await pool.query("SELECT rfc FROM bancos WHERE rfc IS NOT NULL AND rfc<>''");
  return new Set(rows.map((r) => r.rfc.toUpperCase().trim()));
}

/**
 * Clasifica una compra. Dos señales, en orden:
 *   1) El emisor es un banco conocido (bancosRfc, ver bancosComisionRfc) →
 *      siempre comisión/gasto financiero, sin importar uso_cfdi ni concepto.
 *      El uso_cfdi que reportan casi siempre es "G03 Gastos en general" y el
 *      concepto viene abreviado ("COM MEMBRESIA CUENTA E PYME", "SERVICIOS DE
 *      FACTURACIÓN", "PRIMA DE SEGURO...") — no todos dicen literalmente
 *      "comisión", así que depender solo del texto del concepto deja fuera
 *      casos reales. OJO: NO generalizar a "cualquier texto que empiece con
 *      COM" — se probó y rompe con proveedores reales (FARMACOS NACIONALES
 *      factura comprimidos como "LOSARTAN KENDRICK 50 mg 30 COM", donde
 *      "COM" = comprimidos, no comisión).
 *   2) Para cualquier otro proveedor: si el concepto menciona la palabra
 *      completa "comisión"/"comisiones" → también comisión/gasto financiero.
 * Cualquier otro caso sigue la regla de siempre (cuentaPorUsoCfdi).
 * Devuelve { tipo: 'mercancia'|'gasto'|'activo'|'financiero', cuenta }.
 */
function cuentaCompra(uso, cuentaGastoProveedor, conceptos, rfcEmisor, bancosRfc) {
  const rfc = (rfcEmisor || '').toUpperCase().trim();
  if (bancosRfc && bancosRfc.has(rfc)) {
    return { tipo: 'financiero', cuenta: CTA.COMISIONES_BANCARIAS };
  }
  if (conceptos && /comisi[oó]n(es)?/i.test(conceptos)) {
    return { tipo: 'financiero', cuenta: CTA.COMISIONES_BANCARIAS };
  }
  return cuentaPorUsoCfdi(uso, cuentaGastoProveedor);
}

/**
 * Cuenta contable del banco predeterminado (Santander). Cae a CTA.BANCO si no
 * hay banco marcado o no tiene cuenta asignada.
 */
async function cuentaBanco() {
  try {
    const [rows] = await pool.query(
      "SELECT cuenta_contable_codigo FROM bancos WHERE predeterminado=1 AND activo=1 " +
      "ORDER BY id LIMIT 1");
    const c = rows[0] && rows[0].cuenta_contable_codigo;
    return c || CTA.BANCO;
  } catch {
    return CTA.BANCO;
  }
}

module.exports = { CTA, cuentaPorUsoCfdi, cuentaCompra, cuentaBanco, bancosComisionRfc };
