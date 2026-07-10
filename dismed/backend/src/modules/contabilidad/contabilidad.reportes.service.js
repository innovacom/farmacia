/**
 * contabilidad.reportes.service.js — Reportes contables sobre CUENTAS REALES,
 * calculados desde las pólizas (polizas_movimientos), no derivados directo del CFDI.
 *
 * Saldo por cuenta en un periodo:
 *   saldo_inicial = Σ(cargo − abono) de las pólizas ANTES del periodo (mismo ejercicio)
 *   cargos/abonos = del periodo seleccionado
 *   saldo_final   = saldo_inicial + cargos − abonos   (deudor positivo)
 *
 * Modo:
 *   mensual   → periodo = [mes, mes];  saldo_inicial = meses anteriores (incluye apertura)
 *   acumulado → periodo = [1, mes];    saldo_inicial = 0 (la apertura, mes 1, va en el periodo)
 *   sin mes   → ejercicio completo [1,12] (acumulado)
 *
 * Como cada póliza cuadra (Σcargo=Σabono), Σ saldo_final sobre todas las cuentas = 0,
 * así que el Balance cuadra exacto (Activo = Pasivo + Capital) sin caja de ajuste.
 */
const { pool } = require('../../config/db');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const RUBROS_RESULTADO = ['Ingresos', 'Costos', 'Gastos', 'Resultado integral de financiamiento'];

function EMPRESA() {
  return {
    nombre: process.env.EMPRESA_NOMBRE || 'DISMED',
    rfc: process.env.EMPRESA_RFC || '',
  };
}

function httpError(msg, status = 400) { const e = new Error(msg); e.status = status; throw e; }

function resolverPeriodo(f) {
  const anio = parseInt(f.anio, 10);
  if (!anio) httpError('anio es obligatorio');
  const modo = f.modo === 'mensual' ? 'mensual' : 'acumulado';
  const mesRaw = f.mes ? parseInt(f.mes, 10) : null;
  if (mesRaw && (mesRaw < 1 || mesRaw > 12)) httpError('mes inválido');

  let mesDesde, mesHasta, etiqueta, modoEfectivo = modo;
  if (!mesRaw) {
    mesDesde = 1; mesHasta = 12; modoEfectivo = 'acumulado';
    etiqueta = `Ejercicio ${anio}`;
  } else if (modo === 'mensual') {
    mesDesde = mesRaw; mesHasta = mesRaw;
    etiqueta = `${MESES[mesRaw]} ${anio} (mensual)`;
  } else {
    mesDesde = 1; mesHasta = mesRaw;
    etiqueta = mesRaw === 1 ? `${MESES[1]} ${anio}` : `Enero–${MESES[mesRaw]} ${anio} (acumulado)`;
  }
  return { anio, mes: mesRaw, modo: modoEfectivo, mesDesde, mesHasta, etiqueta };
}

// Saldos por cuenta del agrupador para el periodo.
async function saldos(periodo, soloConfirmadas) {
  const cond = soloConfirmadas ? "AND p.estado='confirmada'" : '';
  const [rows] = await pool.query(
    `SELECT m.cuenta_codigo,
            COALESCE(c.nombre, m.cuenta_codigo) AS nombre,
            c.rubro, c.naturaleza, c.nivel,
            SUM(CASE WHEN p.periodo_mes <  ? THEN m.cargo - m.abono ELSE 0 END) AS saldo_inicial,
            SUM(CASE WHEN p.periodo_mes BETWEEN ? AND ? THEN m.cargo ELSE 0 END) AS cargos,
            SUM(CASE WHEN p.periodo_mes BETWEEN ? AND ? THEN m.abono ELSE 0 END) AS abonos
       FROM polizas_movimientos m
       JOIN polizas p ON p.id = m.poliza_id
       LEFT JOIN sat_cuentas_agrupador c ON c.codigo = m.cuenta_codigo COLLATE utf8mb4_general_ci
      WHERE p.periodo_anio = ? ${cond}
      GROUP BY m.cuenta_codigo, c.nombre, c.rubro, c.naturaleza, c.nivel
      ORDER BY m.cuenta_codigo`,
    [periodo.mesDesde, periodo.mesDesde, periodo.mesHasta,
     periodo.mesDesde, periodo.mesHasta, periodo.anio]);

  return rows.map((x) => {
    const si = r2(x.saldo_inicial), cg = r2(x.cargos), ab = r2(x.abonos);
    return {
      codigo: x.cuenta_codigo, nombre: x.nombre, rubro: x.rubro || '(sin rubro)',
      naturaleza: x.naturaleza,
      saldo_inicial: si, cargos: cg, abonos: ab, saldo_final: r2(si + cg - ab),
    };
  }).filter((x) => x.saldo_inicial || x.cargos || x.abonos);
}

function meta(periodo, titulo, extra) {
  return {
    empresa: EMPRESA(),
    titulo,
    periodo: { anio: periodo.anio, mes: periodo.mes, modo: periodo.modo, etiqueta: periodo.etiqueta },
    estatus: extra && extra.soloConfirmadas ? 'solo pólizas confirmadas' : 'todas las pólizas',
    generado: new Date().toISOString(),
  };
}

const NOTA = 'Reporte calculado desde las pólizas (catálogo agrupador SAT): saldo inicial ' +
  '+ movimientos del periodo. Incluye la póliza de apertura. Verifica que las pólizas del ' +
  'periodo estén generadas y, en su caso, confirmadas.';

// ── Balanza de comprobación ─────────────────────────────────────────────────
async function balanza(filtros) {
  const periodo = resolverPeriodo(filtros);
  const soloConfirmadas = filtros.solo_confirmadas === '1' || filtros.solo_confirmadas === 'true';
  const cuentas = await saldos(periodo, soloConfirmadas);

  const t = cuentas.reduce((s, c) => ({
    si_d: s.si_d + Math.max(c.saldo_inicial, 0), si_a: s.si_a + Math.max(-c.saldo_inicial, 0),
    cargos: s.cargos + c.cargos, abonos: s.abonos + c.abonos,
    sf_d: s.sf_d + Math.max(c.saldo_final, 0), sf_a: s.sf_a + Math.max(-c.saldo_final, 0),
  }), { si_d: 0, si_a: 0, cargos: 0, abonos: 0, sf_d: 0, sf_a: 0 });
  for (const k in t) t[k] = r2(t[k]);

  return {
    ...meta(periodo, 'Balanza de Comprobación', { soloConfirmadas }),
    reporte: 'balanza',
    cuentas,
    totales: {
      saldo_inicial_deudor: t.si_d, saldo_inicial_acreedor: t.si_a,
      cargos: t.cargos, abonos: t.abonos,
      saldo_final_deudor: t.sf_d, saldo_final_acreedor: t.sf_a,
      cuadra: Math.abs(t.cargos - t.abonos) < 0.05 && Math.abs(t.sf_d - t.sf_a) < 0.05,
    },
    nota: NOTA,
  };
}

// ── Estado de Resultados ────────────────────────────────────────────────────
async function estadoResultados(filtros) {
  const periodo = resolverPeriodo(filtros);
  const soloConfirmadas = filtros.solo_confirmadas === '1' || filtros.solo_confirmadas === 'true';
  const cuentas = await saldos(periodo, soloConfirmadas);

  // Movimiento neto del periodo por cuenta de resultados (deudor positivo).
  const grupo = (rubro, signo) => {
    const items = cuentas.filter((c) => c.rubro === rubro)
      .map((c) => ({ codigo: c.codigo, nombre: c.nombre, importe: r2(signo * (c.cargos - c.abonos)) }))
      .filter((x) => x.importe);
    const subtotal = r2(items.reduce((s, x) => s + x.importe, 0));
    return { rubro, items, subtotal };
  };
  // Ingresos: acreedora (abono-cargo positivo). Costos/Gastos/Financ: deudora.
  const ingresos = grupo('Ingresos', -1);
  const costos = grupo('Costos', 1);
  const gastos = grupo('Gastos', 1);
  const financ = grupo('Resultado integral de financiamiento', 1);

  const utilidadBruta = r2(ingresos.subtotal - costos.subtotal);
  const utilidad = r2(utilidadBruta - gastos.subtotal - financ.subtotal);
  const margen = ingresos.subtotal ? r2((utilidad / ingresos.subtotal) * 100) : 0;

  return {
    ...meta(periodo, 'Estado de Resultados', { soloConfirmadas }),
    reporte: 'estado_resultados',
    grupos: { ingresos, costos, gastos, financieros: financ },
    resumen: {
      ingresos: ingresos.subtotal, costos: costos.subtotal, utilidad_bruta: utilidadBruta,
      gastos: gastos.subtotal, financieros: financ.subtotal,
      utilidad, margen_utilidad_pct: margen,
    },
    nota: NOTA,
  };
}

// ── Balance General ─────────────────────────────────────────────────────────
async function balanceGeneral(filtros) {
  const periodo = resolverPeriodo(filtros);
  const soloConfirmadas = filtros.solo_confirmadas === '1' || filtros.solo_confirmadas === 'true';
  const cuentas = await saldos(periodo, soloConfirmadas);

  const seccion = (rubro, signo) => cuentas.filter((c) => c.rubro === rubro)
    .map((c) => ({ codigo: c.codigo, cuenta: c.nombre, importe: r2(signo * c.saldo_final) }))
    .filter((x) => x.importe);

  const activo = seccion('Activo', 1);     // deudora: saldo_final positivo
  const pasivo = seccion('Pasivo', -1);    // acreedora: se muestra positivo
  const capitalCuentas = seccion('Capital', -1);

  // Resultado del ejercicio (YTD) = −Σ saldo_final de cuentas de resultados.
  const resultado = r2(-cuentas
    .filter((c) => RUBROS_RESULTADO.includes(c.rubro))
    .reduce((s, c) => s + c.saldo_final, 0));
  const capital = [...capitalCuentas, { codigo: '305', cuenta: 'Resultado del ejercicio', importe: resultado }];

  const totalActivo = r2(activo.reduce((s, c) => s + c.importe, 0));
  const totalPasivo = r2(pasivo.reduce((s, c) => s + c.importe, 0));
  const totalCapital = r2(capital.reduce((s, c) => s + c.importe, 0));

  return {
    ...meta(periodo, 'Balance General', { soloConfirmadas }),
    reporte: 'balance_general',
    activo, pasivo, capital,
    totales: {
      activo: totalActivo, pasivo: totalPasivo, capital: totalCapital,
      pasivo_mas_capital: r2(totalPasivo + totalCapital),
      cuadra: Math.abs(totalActivo - (totalPasivo + totalCapital)) < 0.05,
    },
    nota: NOTA + ' El "Resultado del ejercicio" es la utilidad/pérdida acumulada del año a la fecha de corte.',
  };
}

// ── CFDI: Desglose por comprobante ──────────────────────────────────────────
async function cfdiPorComprobante(f) {
  const where = [], vals = [];
  if (f.tipo && f.tipo !== 'todos')                         { where.push('r.tipo = ?');               vals.push(f.tipo); }
  if (f.tipo_comprobante && f.tipo_comprobante !== 'todos') { where.push('r.tipo_comprobante = ?');   vals.push(f.tipo_comprobante); }
  if (f.desde)                                              { where.push('r.fecha >= ?');              vals.push(f.desde); }
  if (f.hasta)                                              { where.push('r.fecha <= ?');              vals.push(f.hasta + ' 23:59:59'); }
  const estatus = f.estatus || 'vigente';
  if (estatus !== 'todos')                                  { where.push('r.estatus = ?');             vals.push(estatus); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(`
    SELECT
      r.uuid, r.tipo, r.tipo_comprobante, r.fecha,
      r.rfc_emisor, r.nombre_emisor, r.rfc_receptor, r.nombre_receptor,
      r.estatus, r.moneda,
      COUNT(c.id)                                        AS num_conceptos,
      SUM(c.importe)                                     AS subtotal,
      CASE WHEN r.tipo_comprobante = 'N' THEN 0
           ELSE SUM(COALESCE(c.descuento,0)) END         AS descuento,
      CASE WHEN r.tipo_comprobante = 'N' THEN SUM(c.importe)
           ELSE SUM(c.importe - COALESCE(c.descuento,0)) END AS neto,
      SUM(COALESCE(c.importe_iva,0))                     AS total_iva,
      SUM(COALESCE(c.importe_ieps,0))                    AS total_ieps,
      CASE WHEN r.tipo_comprobante = 'N'
           THEN MAX(COALESCE(r.total_impuestos_retenidos,0))
           ELSE SUM(COALESCE(c.importe_isr,0)) END       AS total_isr,
      CASE WHEN r.tipo_comprobante = 'N' THEN
        SUM(c.importe) - MAX(COALESCE(r.total_impuestos_retenidos,0))
      ELSE
        SUM((c.importe - COALESCE(c.descuento,0))
            + COALESCE(c.importe_iva,0)
            + COALESCE(c.importe_ieps,0)
            - COALESCE(c.importe_isr,0))
      END                                                AS total_calculado,
      r.subtotal                                         AS cfdi_subtotal,
      r.total_impuestos_trasladados                      AS cfdi_trasladados,
      r.total_impuestos_retenidos                        AS cfdi_retenidos,
      r.total                                            AS cfdi_total,
      ROUND(r.total - CASE WHEN r.tipo_comprobante = 'N' THEN
        SUM(c.importe) - MAX(COALESCE(r.total_impuestos_retenidos,0))
      ELSE
        SUM((c.importe - COALESCE(c.descuento,0))
            + COALESCE(c.importe_iva,0)
            + COALESCE(c.importe_ieps,0)
            - COALESCE(c.importe_isr,0))
      END, 4)                                            AS diferencia_vs_xml
    FROM cfdi_repositorio r
    JOIN cfdi_repositorio_conceptos c ON c.comprobante_id = r.id
    ${w}
    GROUP BY
      r.id, r.uuid, r.tipo, r.tipo_comprobante, r.fecha,
      r.rfc_emisor, r.nombre_emisor, r.rfc_receptor, r.nombre_receptor,
      r.estatus, r.moneda,
      r.subtotal, r.total_impuestos_trasladados, r.total_impuestos_retenidos, r.total
    ORDER BY r.fecha DESC
  `, vals);

  const n = (x) => Number(x || 0);
  const totales = rows.reduce((s, x) => ({
    num_comprobantes: s.num_comprobantes + 1,
    subtotal:        r2(s.subtotal        + n(x.subtotal)),
    descuento:       r2(s.descuento       + n(x.descuento)),
    neto:            r2(s.neto            + n(x.neto)),
    total_iva:       r2(s.total_iva       + n(x.total_iva)),
    total_ieps:      r2(s.total_ieps      + n(x.total_ieps)),
    total_isr:       r2(s.total_isr       + n(x.total_isr)),
    total_calculado: r2(s.total_calculado + n(x.total_calculado)),
  }), { num_comprobantes: 0, subtotal: 0, descuento: 0, neto: 0, total_iva: 0, total_ieps: 0, total_isr: 0, total_calculado: 0 });

  return {
    empresa: EMPRESA(),
    titulo: 'CFDI — Desglose por Comprobante',
    filtros: { tipo: f.tipo || 'todos', tipo_comprobante: f.tipo_comprobante || 'todos', desde: f.desde, hasta: f.hasta, estatus },
    generado: new Date().toISOString(),
    rows: rows.map((x) => ({
      ...x,
      subtotal: r2(x.subtotal), descuento: r2(x.descuento), neto: r2(x.neto),
      total_iva: r2(x.total_iva), total_ieps: r2(x.total_ieps), total_isr: r2(x.total_isr),
      total_calculado: r2(x.total_calculado), cfdi_subtotal: r2(x.cfdi_subtotal),
      cfdi_trasladados: r2(x.cfdi_trasladados), cfdi_retenidos: r2(x.cfdi_retenidos),
      cfdi_total: r2(x.cfdi_total), diferencia_vs_xml: r2(x.diferencia_vs_xml),
    })),
    totales,
  };
}

// ── CFDI: Resumen general por tipo ──────────────────────────────────────────
async function cfdiResumenGeneral(f) {
  const where = [], vals = [];
  if (f.tipo && f.tipo !== 'todos')                         { where.push('r.tipo = ?');               vals.push(f.tipo); }
  if (f.tipo_comprobante && f.tipo_comprobante !== 'todos') { where.push('r.tipo_comprobante = ?');   vals.push(f.tipo_comprobante); }
  if (f.desde)                                              { where.push('r.fecha >= ?');              vals.push(f.desde); }
  if (f.hasta)                                              { where.push('r.fecha <= ?');              vals.push(f.hasta + ' 23:59:59'); }
  const estatus = f.estatus || 'vigente';
  if (estatus !== 'todos')                                  { where.push('r.estatus = ?');             vals.push(estatus); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(`
    SELECT
      sub.tipo,
      sub.tipo_comprobante,
      COUNT(*)                                           AS num_comprobantes,
      SUM(sub.num_renglones)                             AS num_renglones,
      SUM(sub.subtotal)                                  AS subtotal,
      SUM(sub.descuento)                                 AS descuento,
      SUM(sub.neto)                                      AS neto,
      SUM(sub.total_iva)                                 AS total_iva,
      SUM(sub.total_ieps)                                AS total_ieps,
      SUM(sub.total_isr)                                 AS total_isr,
      SUM(sub.total_general)                             AS total_general
    FROM (
      SELECT
        r.tipo, r.tipo_comprobante,
        COUNT(c.id)                                        AS num_renglones,
        SUM(c.importe)                                     AS subtotal,
        CASE WHEN r.tipo_comprobante = 'N' THEN 0
             ELSE SUM(COALESCE(c.descuento,0)) END         AS descuento,
        CASE WHEN r.tipo_comprobante = 'N' THEN SUM(c.importe)
             ELSE SUM(c.importe - COALESCE(c.descuento,0)) END AS neto,
        SUM(COALESCE(c.importe_iva,0))                     AS total_iva,
        SUM(COALESCE(c.importe_ieps,0))                    AS total_ieps,
        CASE WHEN r.tipo_comprobante = 'N'
             THEN MAX(COALESCE(r.total_impuestos_retenidos,0))
             ELSE SUM(COALESCE(c.importe_isr,0)) END       AS total_isr,
        CASE WHEN r.tipo_comprobante = 'N' THEN
          SUM(c.importe) - MAX(COALESCE(r.total_impuestos_retenidos,0))
        ELSE
          SUM((c.importe - COALESCE(c.descuento,0))
              + COALESCE(c.importe_iva,0)
              + COALESCE(c.importe_ieps,0)
              - COALESCE(c.importe_isr,0))
        END                                                AS total_general
      FROM cfdi_repositorio r
      JOIN cfdi_repositorio_conceptos c ON c.comprobante_id = r.id
      ${w}
      GROUP BY r.id, r.tipo, r.tipo_comprobante
    ) sub
    GROUP BY sub.tipo, sub.tipo_comprobante
    ORDER BY sub.tipo, sub.tipo_comprobante
  `, vals);

  const n = (x) => Number(x || 0);
  const gran_total = rows.reduce((s, x) => ({
    num_comprobantes: s.num_comprobantes + n(x.num_comprobantes),
    num_renglones:    s.num_renglones    + n(x.num_renglones),
    subtotal:         r2(s.subtotal         + n(x.subtotal)),
    descuento:        r2(s.descuento        + n(x.descuento)),
    neto:             r2(s.neto             + n(x.neto)),
    total_iva:        r2(s.total_iva        + n(x.total_iva)),
    total_ieps:       r2(s.total_ieps       + n(x.total_ieps)),
    total_isr:        r2(s.total_isr        + n(x.total_isr)),
    total_general:    r2(s.total_general    + n(x.total_general)),
  }), { num_comprobantes: 0, num_renglones: 0, subtotal: 0, descuento: 0, neto: 0, total_iva: 0, total_ieps: 0, total_isr: 0, total_general: 0 });

  return {
    empresa: EMPRESA(),
    titulo: 'CFDI — Resumen General por Tipo',
    filtros: { tipo: f.tipo || 'todos', tipo_comprobante: f.tipo_comprobante || 'todos', desde: f.desde, hasta: f.hasta, estatus },
    generado: new Date().toISOString(),
    rows: rows.map((x) => ({
      ...x,
      subtotal: r2(x.subtotal), descuento: r2(x.descuento), neto: r2(x.neto),
      total_iva: r2(x.total_iva), total_ieps: r2(x.total_ieps), total_isr: r2(x.total_isr),
      total_general: r2(x.total_general),
    })),
    gran_total,
  };
}

module.exports = { resolverPeriodo, saldos, balanza, estadoResultados, balanceGeneral, cfdiPorComprobante, cfdiResumenGeneral };
