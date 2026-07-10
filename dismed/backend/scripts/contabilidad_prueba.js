#!/usr/bin/env node
/**
 * scripts/contabilidad_prueba.js — Imprime los tres reportes contables
 * (Estado de Resultados, Balance General, Balanza de Comprobación) usando los
 * CFDI ya guardados en `cfdi_repositorio`. Solo lectura.
 *
 * Uso:
 *   node scripts/contabilidad_prueba.js              # mayo 2026 (default)
 *   node scripts/contabilidad_prueba.js 2026 5       # año mes
 *   node scripts/contabilidad_prueba.js 2026         # ejercicio anual completo
 */
require('dotenv').config();
const { pool } = require('../src/config/db');
const svc = require('../src/modules/contabilidad/contabilidad.service');

const money = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(72));

(async () => {
  const [anio = '2026', mes = '5'] = process.argv.slice(2);
  const filtros = { anio, mes: mes === '' ? undefined : mes };

  try {
    const er = await svc.estadoResultados(filtros);
    rule();
    line(`${er.empresa.nombre}  ${er.empresa.rfc}`);
    line(`ESTADO DE RESULTADOS — ${er.periodo.etiqueta} (${er.estatus})`);
    rule();
    for (const r of er.renglones) {
      const sangria = '  '.repeat(r.nivel || 0);
      const docs = r.docs != null ? `  [${r.docs} CFDI]` : '';
      line(`${sangria}${r.concepto}${docs}`.padEnd(58) + money(r.importe).padStart(14));
    }
    line('');
    line(`  Margen de utilidad: ${er.resumen.margen_utilidad_pct} %`);
    line(`  IVA trasladado: ${money(er.base_fiscal.iva_trasladado)}  |  IVA acreditable: ${money(er.base_fiscal.iva_acreditable)}`);
    line(`  IVA neto (${er.base_fiscal.iva_neto_signo}): ${money(Math.abs(er.base_fiscal.iva_neto))}`);

    const bg = await svc.balanceGeneral(filtros);
    line(''); rule();
    line(`BALANCE GENERAL (estimado) — ${bg.periodo.etiqueta}`);
    rule();
    line('ACTIVO');
    for (const c of bg.activo) line(`  ${c.codigo} ${c.cuenta}`.padEnd(50) + money(c.importe).padStart(16));
    line('  Total activo'.padEnd(50) + money(bg.totales.activo).padStart(16));
    line('PASIVO');
    for (const c of bg.pasivo) line(`  ${c.codigo} ${c.cuenta}`.padEnd(50) + money(c.importe).padStart(16));
    line('  Total pasivo'.padEnd(50) + money(bg.totales.pasivo).padStart(16));
    line('CAPITAL');
    for (const c of bg.capital) line(`  ${c.codigo} ${c.cuenta}`.padEnd(50) + money(c.importe).padStart(16));
    line('  Total capital'.padEnd(50) + money(bg.totales.capital).padStart(16));
    line('  Pasivo + Capital'.padEnd(50) + money(bg.totales.pasivo_mas_capital).padStart(16));
    line(`  ¿Cuadra (Activo = Pasivo + Capital)? ${bg.totales.cuadra ? 'SÍ' : 'NO'}`);

    const bz = await svc.balanzaComprobacion(filtros);
    line(''); rule();
    line(`BALANZA DE COMPROBACIÓN (derivada) — ${bz.periodo.etiqueta}`);
    rule();
    line('Cta   Cuenta'.padEnd(46) + 'Cargos'.padStart(13) + 'Abonos'.padStart(13));
    for (const c of bz.cuentas) {
      line(`${c.codigo.padEnd(5)} ${c.cuenta}`.padEnd(46) +
        (c.cargos ? money(c.cargos) : '—').padStart(13) +
        (c.abonos ? money(c.abonos) : '—').padStart(13));
    }
    line('SUMAS IGUALES'.padEnd(46) + money(bz.totales.cargos).padStart(13) + money(bz.totales.abonos).padStart(13));
    line(`¿Cuadra (Debe = Haber)? ${bz.totales.cuadra ? 'SÍ' : 'NO'}`);
    rule();

    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
})();
