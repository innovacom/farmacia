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
  RET_GENERICA:       '216',    // Impuestos retenidos (fallback)
  // Capital
  RESULTADO:          '305',    // Resultado del ejercicio
  // Ingresos / Costos / Gastos
  INGRESOS:           '401',    // Ingresos (ventas)
  COSTO_VENTA:        '501.01', // Costo de venta
  GASTOS:             '601',    // Gastos generales (default de gasto)
  SUELDOS:            '601.01', // Sueldos y salarios
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
  // G03 gastos en general, P01 por definir, vacío, etc. → gasto del proveedor o 601
  return { tipo: 'gasto', cuenta: cuentaGastoProveedor || CTA.GASTOS };
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

module.exports = { CTA, cuentaPorUsoCfdi, cuentaBanco };
