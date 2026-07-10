/**
 * contabilidad.service.js — Reportes contables derivados del repositorio fiscal
 * de CFDI (`cfdi_repositorio`). SOLO LECTURA: no escribe ni altera el esquema.
 *
 * IMPORTANTE — alcance y honestidad de los datos:
 *   El SAT NO publica un "formato"/documento descargable para los pagos
 *   provisionales de ISR/IVA: esas declaraciones se presentan en línea en
 *   "Declaraciones y Pagos" (prellenadas con los CFDI). Por eso aquí generamos
 *   los reportes contables ESTÁNDAR (Estado de Resultados, Balance General y
 *   Balanza de Comprobación) a partir del FLUJO de CFDI emitidos y recibidos.
 *
 *   Estos reportes son DERIVADOS de comprobantes, no de una contabilidad
 *   formal con catálogo de cuentas y saldos iniciales: no incluyen
 *   depreciaciones, provisiones, saldos de apertura de caja/activo fijo,
 *   préstamos ni capital social. Sirven como papel de trabajo / aproximación,
 *   no sustituyen la contabilidad electrónica. Cada respuesta incluye el flag
 *   `derivado: true` y una `nota` para mostrarlo en pantalla.
 *
 * Convención de tipos:
 *   tipo            'emitido'  = nuestro RFC es emisor (ventas / ingresos)
 *                   'recibido' = somos receptor (compras / gastos)
 *   tipo_comprobante 'I'=Ingreso 'E'=Egreso(nota de crédito) 'P'=Pago
 *                    'N'=Nómina 'T'=Traslado
 *
 * Importes en MXN: los CFDI en otra moneda se convierten con su tipo de cambio.
 */
const { pool } = require('../../config/db');

const EMPRESA = () => ({
  nombre: process.env.EMPRESA_NOMBRE || 'INNOVACOM',
  rfc: process.env.EMPRESA_RFC || '',
});

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const pad = (n) => String(n).padStart(2, '0');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Resuelve el periodo a consultar a partir de los filtros.
 *   { anio, mes }            → mes completo (mes 1-12)
 *   { anio }                 → año completo (acumulado enero–diciembre)
 *   { desde, hasta }         → rango explícito 'YYYY-MM-DD'
 * Devuelve { desde, hasta, etiqueta, anio, mes }.
 */
function resolverPeriodo({ anio, mes, desde, hasta } = {}) {
  if (desde && hasta) {
    const d = String(desde).slice(0, 10);
    const h = String(hasta).slice(0, 10);
    if (new Date(d) > new Date(h)) throw httpError(400, 'La fecha "desde" no puede ser mayor que "hasta".');
    return { desde: `${d} 00:00:00`, hasta: `${h} 23:59:59`, etiqueta: `${d} a ${h}`, anio: null, mes: null };
  }
  const y = parseInt(anio, 10);
  if (!y || y < 2000 || y > 2100) throw httpError(400, 'Indica un año válido (anio) o un rango desde/hasta.');
  if (mes !== undefined && mes !== null && mes !== '') {
    const m = parseInt(mes, 10);
    if (m < 1 || m > 12) throw httpError(400, 'El mes debe estar entre 1 y 12.');
    const last = new Date(y, m, 0).getDate();
    return {
      desde: `${y}-${pad(m)}-01 00:00:00`,
      hasta: `${y}-${pad(m)}-${pad(last)} 23:59:59`,
      etiqueta: `${MESES[m]} ${y}`, anio: y, mes: m,
    };
  }
  return { desde: `${y}-01-01 00:00:00`, hasta: `${y}-12-31 23:59:59`, etiqueta: `Ejercicio ${y}`, anio: y, mes: null };
}

/** Estatus a considerar. Por defecto solo 'vigente' (lo válido fiscalmente). */
function resolverEstatus({ incluir_cancelados } = {}) {
  const inc = incluir_cancelados === true || incluir_cancelados === 'true' || incluir_cancelados === '1';
  return inc ? ['vigente', 'cancelado', 'desconocido'] : ['vigente'];
}

/**
 * Suma los importes del repositorio agrupados por tipo y tipo_comprobante.
 * Convierte a MXN con el tipo de cambio del comprobante. Devuelve un acceso
 * `get(tipo, tc)` y `sum(tipo, [tcs], campo)` con ceros cuando no hay datos.
 */
async function agregados(periodo, estatuses) {
  const place = estatuses.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT tipo, tipo_comprobante AS tc,
            COUNT(*)                                           AS docs,
            SUM(subtotal   * COALESCE(NULLIF(tipo_cambio,0),1)) AS subtotal,
            SUM(descuento  * COALESCE(NULLIF(tipo_cambio,0),1)) AS descuento,
            SUM(total      * COALESCE(NULLIF(tipo_cambio,0),1)) AS total,
            SUM(COALESCE(total_impuestos_trasladados,0) * COALESCE(NULLIF(tipo_cambio,0),1)) AS iva_tras,
            SUM(COALESCE(total_impuestos_retenidos,0)   * COALESCE(NULLIF(tipo_cambio,0),1)) AS ret
       FROM cfdi_repositorio
      WHERE fecha >= ? AND fecha <= ? AND estatus IN (${place})
      GROUP BY tipo, tipo_comprobante`,
    [periodo.desde, periodo.hasta, ...estatuses]
  );

  const map = new Map();
  for (const r of rows) map.set(`${r.tipo}_${r.tc}`, r);
  const get = (tipo, tc) => map.get(`${tipo}_${tc}`) || {};
  // Suma de un campo para un tipo y una lista de tipos de comprobante.
  const sum = (tipo, tcs, campo) =>
    tcs.reduce((acc, tc) => acc + Number(get(tipo, tc)[campo] || 0), 0);
  const docs = (tipo, tcs) => tcs.reduce((acc, tc) => acc + Number(get(tipo, tc).docs || 0), 0);
  return { rows, get, sum, docs };
}

/**
 * Bloques de cifras comunes a los tres reportes, ya netos de notas de crédito.
 * Ingreso (I) menos Egreso (E) en cada lado.
 */
async function calcularBase(periodo, estatuses) {
  const a = await agregados(periodo, estatuses);

  // Ventas (emitidos): Ingreso 'I' (bruto) y notas de crédito 'E'.
  const ventasBruto = r2(a.sum('emitido', ['I'], 'subtotal'));
  const ncVentasSub = r2(a.sum('emitido', ['E'], 'subtotal'));
  const ventasSub   = r2(ventasBruto - ncVentasSub);                       // ingresos netos
  const ventasIva   = r2(a.sum('emitido', ['I'], 'iva_tras') - a.sum('emitido', ['E'], 'iva_tras'));
  const ventasTot   = r2(a.sum('emitido', ['I'], 'total') - a.sum('emitido', ['E'], 'total'));
  const ventasRet   = r2(a.sum('emitido', ['I'], 'ret') - a.sum('emitido', ['E'], 'ret'));

  // Compras y gastos (recibidos): Ingreso 'I' (bruto) y notas de crédito 'E'.
  const comprasBruto = r2(a.sum('recibido', ['I'], 'subtotal'));
  const ncComprasSub = r2(a.sum('recibido', ['E'], 'subtotal'));
  const comprasSub   = r2(comprasBruto - ncComprasSub);
  const comprasIva   = r2(a.sum('recibido', ['I'], 'iva_tras') - a.sum('recibido', ['E'], 'iva_tras'));
  const comprasTot   = r2(a.sum('recibido', ['I'], 'total') - a.sum('recibido', ['E'], 'total'));
  const comprasRet   = r2(a.sum('recibido', ['I'], 'ret') - a.sum('recibido', ['E'], 'ret'));

  // Nómina emitida (CFDI 'N'): sueldos y salarios pagados.
  const nominaTot  = r2(a.sum('emitido', ['N'], 'total'));
  const nominaDocs = a.docs('emitido', ['N']);

  const utilidad = r2(ventasSub - comprasSub - nominaTot);

  return {
    agg: a,
    ventasBruto, ncVentasSub, ventasSub, ventasIva, ventasTot, ventasRet,
    comprasBruto, ncComprasSub, comprasSub, comprasIva, comprasTot, comprasRet,
    nominaTot, nominaDocs,
    utilidad,
    docs: {
      ventas: a.docs('emitido', ['I']), ncEmit: a.docs('emitido', ['E']),
      compras: a.docs('recibido', ['I']), ncRec: a.docs('recibido', ['E']),
      nomina: nominaDocs,
    },
  };
}

const NOTA_DERIVADO =
  'Reporte derivado del flujo de CFDI emitidos y recibidos (no de una contabilidad ' +
  'formal con catálogo de cuentas y saldos iniciales). No incluye depreciaciones, ' +
  'provisiones, saldos de apertura ni capital social. Úsese como papel de trabajo; ' +
  'no sustituye la contabilidad electrónica ni la declaración del SAT.';

function meta(periodo, estatuses) {
  return {
    empresa: EMPRESA(),
    periodo: { desde: periodo.desde, hasta: periodo.hasta, etiqueta: periodo.etiqueta, anio: periodo.anio, mes: periodo.mes },
    estatus: estatuses.length === 1 ? 'solo vigentes' : 'vigentes + cancelados',
    derivado: true,
    nota: NOTA_DERIVADO,
    generado: new Date().toISOString(),
  };
}

// ── Estado de Resultados ────────────────────────────────────────────────────
async function estadoResultados(filtros) {
  const periodo = resolverPeriodo(filtros);
  const estatuses = resolverEstatus(filtros);
  const b = await calcularBase(periodo, estatuses);

  const margen = b.ventasSub ? r2((b.utilidad / b.ventasSub) * 100) : 0;
  const ivaNeto = r2(b.ventasIva - b.comprasIva); // a cargo (+) / a favor (−)

  const renglones = [
    { concepto: 'Ingresos por ventas (CFDI emitidos tipo I)', importe: b.ventasBruto, nivel: 1, docs: b.docs.ventas },
    { concepto: '(−) Devoluciones y descuentos s/ventas (notas de crédito emitidas)', importe: -b.ncVentasSub, nivel: 2, docs: b.docs.ncEmit },
    { concepto: 'Ingresos netos', importe: b.ventasSub, nivel: 0, total: true },
    { concepto: '(−) Compras y gastos (CFDI recibidos tipo I)', importe: -b.comprasBruto, nivel: 1, docs: b.docs.compras },
    { concepto: '(+) Devoluciones y descuentos s/compras (notas de crédito recibidas)', importe: b.ncComprasSub, nivel: 2, docs: b.docs.ncRec },
    { concepto: '(−) Sueldos y nómina (CFDI de nómina emitidos)', importe: -b.nominaTot, nivel: 1, docs: b.docs.nomina },
    { concepto: 'Utilidad (o pérdida) del periodo', importe: b.utilidad, nivel: 0, total: true, resultado: true },
  ];

  return {
    ...meta(periodo, estatuses),
    reporte: 'estado_resultados',
    titulo: 'Estado de Resultados',
    renglones,
    resumen: {
      ingresos_netos: b.ventasSub,
      compras_gastos: b.comprasSub,
      nomina: b.nominaTot,
      utilidad: b.utilidad,
      margen_utilidad_pct: margen,
    },
    base_fiscal: {
      iva_trasladado: b.ventasIva,
      iva_acreditable: b.comprasIva,
      iva_neto: ivaNeto,
      iva_neto_signo: ivaNeto >= 0 ? 'a cargo' : 'a favor',
      isr_retenido_a_terceros: b.comprasRet,
      isr_iva_retenido_por_clientes: b.ventasRet,
      nota: 'Cifras informativas para conciliar el pago provisional. El IVA neto = trasladado (ventas) − acreditable (compras).',
    },
  };
}

// ── Balance General (estimado) ──────────────────────────────────────────────
async function balanceGeneral(filtros) {
  const periodo = resolverPeriodo(filtros);
  const estatuses = resolverEstatus(filtros);
  const b = await calcularBase(periodo, estatuses);

  // Cuentas derivadas del flujo de CFDI del periodo.
  const clientes      = b.ventasTot;          // por cobrar (total emitido neto)
  const ivaAcred      = b.comprasIva;         // IVA acreditable (pagado en compras)
  const proveedores   = b.comprasTot;         // por pagar (total recibido neto)
  const ivaTrasladado = b.ventasIva;          // IVA trasladado (por pagar)
  const resultado     = b.utilidad;           // resultado del ejercicio (capital)

  // Caja y bancos como CUADRE para respetar la identidad contable
  // Activo = Pasivo + Capital. Es una posición derivada, no un saldo real.
  const caja = r2((proveedores + ivaTrasladado + resultado) - (clientes + ivaAcred));

  const totalActivo  = r2(caja + clientes + ivaAcred);
  const totalPasivo  = r2(proveedores + ivaTrasladado);
  const totalCapital = r2(resultado);

  const activo = [
    { cuenta: 'Caja y bancos (posición de cuadre)', codigo: '101', importe: caja, estimado: true },
    { cuenta: 'Clientes por cobrar', codigo: '105', importe: clientes },
    { cuenta: 'IVA acreditable (pagado)', codigo: '118', importe: ivaAcred },
  ];
  const pasivo = [
    { cuenta: 'Proveedores por pagar', codigo: '201', importe: proveedores },
    { cuenta: 'IVA trasladado (por pagar)', codigo: '208', importe: ivaTrasladado },
  ];
  const capital = [
    { cuenta: 'Resultado del ejercicio', codigo: '305', importe: resultado },
  ];

  return {
    ...meta(periodo, estatuses),
    reporte: 'balance_general',
    titulo: 'Balance General (estimado)',
    activo, pasivo, capital,
    totales: {
      activo: totalActivo,
      pasivo: totalPasivo,
      capital: totalCapital,
      pasivo_mas_capital: r2(totalPasivo + totalCapital),
      cuadra: Math.abs(totalActivo - (totalPasivo + totalCapital)) < 0.05,
    },
    nota: NOTA_DERIVADO + ' En particular, "Caja y bancos" es una posición de ' +
      'cuadre (no un saldo bancario real) y no se consideran activos fijos, ' +
      'inventarios, préstamos ni capital social.',
  };
}

// ── Balanza de Comprobación (derivada) ──────────────────────────────────────
async function balanzaComprobacion(filtros) {
  const periodo = resolverPeriodo(filtros);
  const estatuses = resolverEstatus(filtros);
  const b = await calcularBase(periodo, estatuses);

  // Partida doble implícita en cada CFDI:
  //   Venta (emit I): Cargo Clientes(total) = Abono Ventas(subtotal)+IVA trasladado(iva)
  //   Compra(rec I) : Cargo Compras(subtotal)+IVA acreditable(iva) = Abono Proveedores(total)
  //   Nómina(emit N): Cargo Sueldos(total) = Abono Acreedores/contrapartida(total)
  const cuentas = [
    { codigo: '105', cuenta: 'Clientes',                   cargos: b.ventasTot,  abonos: 0,            naturaleza: 'deudora' },
    { codigo: '118', cuenta: 'IVA acreditable (pagado)',   cargos: b.comprasIva, abonos: 0,            naturaleza: 'deudora' },
    { codigo: '501', cuenta: 'Compras y gastos',           cargos: b.comprasSub, abonos: 0,            naturaleza: 'deudora' },
    { codigo: '601', cuenta: 'Sueldos y nómina',           cargos: b.nominaTot,  abonos: 0,            naturaleza: 'deudora' },
    { codigo: '201', cuenta: 'Proveedores',                cargos: 0,            abonos: b.comprasTot, naturaleza: 'acreedora' },
    { codigo: '208', cuenta: 'IVA trasladado (por pagar)', cargos: 0,            abonos: b.ventasIva,  naturaleza: 'acreedora' },
    { codigo: '401', cuenta: 'Ventas / Ingresos',          cargos: 0,            abonos: b.ventasSub,  naturaleza: 'acreedora' },
    { codigo: '210', cuenta: 'Acreedores diversos (contrapartida nómina)', cargos: 0, abonos: b.nominaTot, naturaleza: 'acreedora' },
  ];

  let totalCargos = r2(cuentas.reduce((s, c) => s + c.cargos, 0));
  let totalAbonos = r2(cuentas.reduce((s, c) => s + c.abonos, 0));

  // Las retenciones e IEPS hacen que total != subtotal+IVA; absorbemos la
  // diferencia en una cuenta de ajuste para que la balanza cuadre (debe=haber).
  const dif = r2(totalCargos - totalAbonos);
  if (Math.abs(dif) >= 0.01) {
    if (dif > 0) cuentas.push({ codigo: '999', cuenta: 'Ajuste (retenciones / redondeo)', cargos: 0, abonos: dif, naturaleza: 'acreedora' });
    else cuentas.push({ codigo: '999', cuenta: 'Ajuste (retenciones / redondeo)', cargos: -dif, abonos: 0, naturaleza: 'deudora' });
    totalCargos = r2(cuentas.reduce((s, c) => s + c.cargos, 0));
    totalAbonos = r2(cuentas.reduce((s, c) => s + c.abonos, 0));
  }

  // Redondeo de presentación.
  for (const c of cuentas) { c.cargos = r2(c.cargos); c.abonos = r2(c.abonos); }

  return {
    ...meta(periodo, estatuses),
    reporte: 'balanza_comprobacion',
    titulo: 'Balanza de Comprobación (derivada)',
    cuentas,
    totales: {
      cargos: totalCargos,
      abonos: totalAbonos,
      cuadra: Math.abs(totalCargos - totalAbonos) < 0.05,
    },
    nota: NOTA_DERIVADO + ' Las cuentas son agrupaciones derivadas de los CFDI ' +
      '(no un catálogo contable real) y la balanza se cuadra con una cuenta de ajuste.',
  };
}

module.exports = {
  resolverPeriodo, resolverEstatus,
  estadoResultados, balanceGeneral, balanzaComprobacion,
};
