#!/usr/bin/env node
/**
 * scripts/parse_sat_agrupador.js — Extrae el "Código agrupador de cuentas del SAT"
 * (Anexo 24 RMF 2026) desde el .md generado por PDF→texto.
 *
 * El texto del PDF trae cada página en "corridas de columna": un bloque de
 * códigos, un bloque de niveles y un bloque de nombres (en orden variable por
 * página, pero los nombres siempre van al final de la página). Al concatenar
 * globalmente cada clase en orden de aparición, la i-ésima fila queda alineada
 * (código[i], nivel[i], nombre[i]) porque cada columna lista sus filas en orden.
 *
 * Uso:  node scripts/parse_sat_agrupador.js [ruta.md]
 * Imprime conteos, landmarks de validación y un JSON en stdout si --json.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_MD = path.resolve(__dirname, '../../../contabilidad_electronica_Sat.md');

// Rango del catálogo (código agrupador) dentro del documento.
const START_LINE = 122;   // primer código (100)
const END_LINE = 6677;    // tras 899.02; antes de "n*"/"000"/sección B

const HEADER_RX = [
  /^DIARIO OFICIAL/i,
  /^Martes 13 de enero de 2026/i,
  /^Nivel/i,
  /^agrupador$/i,
  /^Código$/i,
  /^Nombre de la cuenta/i,
];

// El nivel del texto es LOSSY (se pierden renglones de mayor). Se ignora y se
// deriva del propio código: con punto => subcuenta (nivel 2); sin punto => mayor
// (nivel 1). Los nombres a veces vienen partidos en 2 líneas por ajuste de
// columna; una línea de continuación empieza en minúscula (los nombres de cuenta
// del SAT siempre inician en mayúscula/dígito/sigla).
function classify(line) {
  const s = line.trim();
  if (!s) return null;
  if (HEADER_RX.some((rx) => rx.test(s))) return null;
  if (/^\d{3}(\.\d{1,2})?$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 100 && n <= 899) return { kind: 'code', value: s };
    return null; // 000, etc.
  }
  if (/^[12]$/.test(s)) return null; // nivel: se descarta (lossy en el PDF)
  if (s === 'n*' || s === '000') return null;
  return { kind: 'name', value: s };
}

// ¿La línea es continuación del nombre anterior? Empieza en minúscula (incluye
// acentuadas) tras corte de columna.
function esContinuacion(s) {
  return /^[a-záéíóúüñ]/.test(s);
}

function parse(mdPath) {
  const lines = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);
  const codes = [];
  const names = [];
  for (let i = START_LINE - 1; i < END_LINE && i < lines.length; i++) {
    const c = classify(lines[i]);
    if (!c) continue;
    if (c.kind === 'code') codes.push(c.value);
    else if (names.length && esContinuacion(c.value)) {
      names[names.length - 1] += ' ' + c.value; // unir wrap
    } else {
      names.push(c.value);
    }
  }
  return { codes, names };
}

function build(mdPath) {
  const { codes, names } = parse(mdPath);
  const n = Math.min(codes.length, names.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const codigo = codes[i];
    rows.push({
      codigo,
      nivel: codigo.includes('.') ? 2 : 1,
      nombre: names[i].replace(/\s{2,}/g, ' ').trim(),
      padre: codigo.includes('.') ? codigo.split('.')[0] : null,
      naturaleza: naturalezaPorCodigo(codigo),
      rubro: rubroPorCodigo(codigo),
    });
  }
  return { rows, counts: { codes: codes.length, names: names.length } };
}

// Naturaleza por rango de mayor (deudora D / acreedora A) según clasificación SAT.
function naturalezaPorCodigo(codigo) {
  const mayor = parseInt(codigo, 10);
  if (mayor >= 100 && mayor <= 199) return 'D'; // Activo
  if (mayor >= 200 && mayor <= 299) return 'A'; // Pasivo
  if (mayor >= 300 && mayor <= 399) return 'A'; // Capital
  if (mayor >= 400 && mayor <= 499) return 'A'; // Ingresos
  if (mayor >= 500 && mayor <= 599) return 'D'; // Costos
  if (mayor >= 600 && mayor <= 699) return 'D'; // Gastos
  if (mayor >= 700 && mayor <= 799) return 'D'; // Result. financiero / otros (mixta -> D por defecto)
  if (mayor >= 800 && mayor <= 899) return 'D'; // Cuentas de orden
  return 'D';
}

// Rubro (clasificación mayor) por rango del código agrupador del SAT.
function rubroPorCodigo(codigo) {
  switch (codigo[0]) {
    case '1': return 'Activo';
    case '2': return 'Pasivo';
    case '3': return 'Capital';
    case '4': return 'Ingresos';
    case '5': return 'Costos';
    case '6': return 'Gastos';
    case '7': return 'Resultado integral de financiamiento';
    case '8': return 'Cuentas de orden';
    default:  return 'Otras';
  }
}

if (require.main === module) {
  const mdPath = process.argv.find((a) => a.endsWith('.md')) || DEFAULT_MD;
  const wantJson = process.argv.includes('--json');
  const { rows, counts } = build(mdPath);

  if (wantJson) {
    process.stdout.write(JSON.stringify(rows));
    process.exit(0);
  }

  console.log('Archivo:', mdPath);
  console.log('Conteos  codes=%d names=%d  -> filas=%d', counts.codes, counts.names, rows.length);
  console.log('Alineado:', counts.codes === counts.names ? 'SÍ' : `NO (dif ${counts.codes - counts.names})`);

  const find = (cod) => rows.find((r) => r.codigo === cod);
  console.log('\n--- Landmarks de validación ---');
  for (const cod of ['100', '101', '101.01', '102', '105', '201', '206', '301', '401', '501', '601', '899', '899.02']) {
    const r = find(cod);
    console.log(`  ${cod.padEnd(8)} -> ${r ? `n${r.nivel} ${r.naturaleza} ${r.nombre}` : '(no encontrado)'}`);
  }
  console.log('\nPrimeras 6:', rows.slice(0, 6).map((r) => `${r.codigo}=${r.nombre}`).join(' | '));
  console.log('Últimas 4 :', rows.slice(-4).map((r) => `${r.codigo}=${r.nombre}`).join(' | '));
}

module.exports = { build, parse };
