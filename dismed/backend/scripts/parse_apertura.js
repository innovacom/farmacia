/**
 * parse_apertura.js — Convierte la balanza de comprobación del contador en los
 * saldos iniciales (póliza de apertura) a nivel del Código Agrupador SAT.
 *
 *   node scripts/parse_apertura.js          imprime el resumen
 *   node scripts/parse_apertura.js --json    además escribe saldos_iniciales_2026.json
 *
 * Fuente: Balanza_de_comprobación.xlsx (raíz del proyecto). El plan de cuentas del
 * contador es el agrupador SAT con sufijo interno: AAA-BB-CCC, donde
 *   AAA-00-000  = total del mayor              (se ignora)
 *   AAA-BB-000  = subcuenta agrupador AAA.BB   (se USA, salvo rubros de agrupación)
 *   AAA-BB-CCC  = auxiliar interno (cliente/proveedor/banco)  (se ignora aquí)
 * Los rubros de agrupación del propio contador (100,200,300… → AAA%100==0) son
 * subtotales, no cuentas, y se excluyen.
 *
 * Saldo de apertura = Cargos − Abonos (los saldos iniciales de la balanza son 0
 * porque enero 2026 es el primer mes de operación). La suma de (cargos−abonos) sobre
 * todas las cuentas posteables es 0, así que la póliza de apertura cuadra por
 * construcción. Fecha de corte: 31-ene-2026; el sistema opera desde febrero.
 *
 * El JSON estático se versiona y se carga en el VPS (el .xlsx no se despliega).
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const FILE = process.argv.find((a) => a.endsWith('.xlsx')) ||
  path.resolve(__dirname, '../../../Balanza_de_comprobación.xlsx');
const OUT = path.resolve(__dirname, 'saldos_iniciales_2026.json');
const EJERCICIO = 2026;
const FECHA_CORTE = '2026-01-31';

const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '').trim()); return isNaN(n) ? 0 : n; };

function parse() {
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  // Columnas: 0 Cuenta | 1 Nombre | 4 Cargos | 5 Abonos
  const movimientos = [];
  for (let i = 0; i < rows.length; i++) {
    const cuenta = String(rows[i][0] || '').trim();
    const m = cuenta.match(/^(\d{3})-(\d{2})-(\d{3})$/);
    if (!m) continue;
    const [, aaa, bb, ccc] = m;
    if (ccc !== '000' || bb === '00' || Number(aaa) % 100 === 0) continue;
    const saldo = num(rows[i][4]) - num(rows[i][5]);
    if (Math.abs(saldo) < 0.005) continue;
    movimientos.push({
      cuenta_codigo: `${aaa}.${bb}`,
      nombre: String(rows[i][1]).trim(),
      cargo: saldo > 0 ? Math.round(saldo * 100) / 100 : 0,
      abono: saldo < 0 ? Math.round(-saldo * 100) / 100 : 0,
    });
  }
  const total_cargos = Math.round(movimientos.reduce((s, x) => s + x.cargo, 0) * 100) / 100;
  const total_abonos = Math.round(movimientos.reduce((s, x) => s + x.abono, 0) * 100) / 100;
  return {
    meta: {
      ejercicio: EJERCICIO, fecha_corte: FECHA_CORTE,
      fuente: path.basename(FILE), generado: new Date().toISOString(),
      total_cargos, total_abonos, cuentas: movimientos.length,
      cuadra: Math.abs(total_cargos - total_abonos) < 0.05,
    },
    movimientos,
  };
}

const data = parse();
console.log(`Cuentas: ${data.meta.cuentas} | cargos ${data.meta.total_cargos} | abonos ${data.meta.total_abonos} | cuadra: ${data.meta.cuadra}`);
for (const m of data.movimientos) {
  console.log('  ' + m.cuenta_codigo.padEnd(8),
    (m.cargo ? m.cargo.toFixed(2) : '').padStart(15),
    (m.abono ? m.abono.toFixed(2) : '').padStart(15), ' ' + m.nombre);
}
if (process.argv.includes('--json')) {
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log('\nEscrito ' + OUT);
}
