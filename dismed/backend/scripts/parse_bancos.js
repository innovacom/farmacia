#!/usr/bin/env node
/**
 * scripts/parse_bancos.js — Extrae el catálogo de bancos de México (catálogo de
 * bancos del SAT, Anexo 24) desde bancos.csv del raíz del proyecto.
 *
 * El CSV viene en CP850/CP437 (DOS) y, por el origen PDF, la "razón social" a veces se
 * parte en varias líneas: esos renglones traen clave/corto vacíos (o clave 000) y
 * sólo continúan el texto del banco anterior. También hay un encabezado repetido a
 * mitad del archivo y filas basura (N/A) que se descartan.
 *
 * Uso:  node scripts/parse_bancos.js [--json]
 */
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const DEFAULT_CSV = path.resolve(__dirname, '../../../bancos.csv');

// Divide una línea CSV en a lo más 3 campos (la razón social puede no traer comas,
// usa doble espacio como separador interno, así que basta cortar en las 2 primeras).
function split3(line) {
  const i1 = line.indexOf(',');
  if (i1 < 0) return [line.trim(), '', ''];
  const i2 = line.indexOf(',', i1 + 1);
  if (i2 < 0) return [line.slice(0, i1).trim(), line.slice(i1 + 1).trim(), ''];
  return [line.slice(0, i1).trim(), line.slice(i1 + 1, i2).trim(), line.slice(i2 + 1).trim()];
}

const limpiar = (s) => s.replace(/\s{2,}/g, ' ').replace(/\s+\./g, '.').trim();

function esEncabezado(corto, razon) {
  return corto === 'Nombre corto' || /^Nombre o raz/i.test(razon);
}

function parse(csvPath) {
  const buf = fs.readFileSync(csvPath);
  // El archivo está en CP850 (DOS): byte 0x82=é, 0xA2=ó, 0xA3=ú, etc.
  const text = iconv.decode(buf, 'cp850');
  const lines = text.split(/\r?\n/);

  const bancos = [];
  for (let i = 1; i < lines.length; i++) { // i=0 es el encabezado
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const [clave, corto, razon] = split3(raw);
    if (esEncabezado(corto, razon)) continue;

    if (corto) {
      // Nuevo banco. clave válida = 3 dígitos distinta de 000; si no, null.
      const claveSat = /^\d{3}$/.test(clave) && clave !== '000' ? clave : null;
      bancos.push({ clave_sat: claveSat, nombre_corto: limpiar(corto), razon_social: limpiar(razon) });
    } else if (razon) {
      // Continuación de la razón social del banco anterior.
      if (bancos.length) bancos[bancos.length - 1].razon_social = limpiar(bancos[bancos.length - 1].razon_social + ' ' + razon);
    }
    // corto vacío y razón vacía -> fila en blanco, se ignora.
  }

  // Descarta filas sin razón social (basura tipo "N/A" o stubs sin nombre).
  return bancos.filter((b) => b.razon_social && b.nombre_corto && b.nombre_corto !== 'N/A');
}

if (require.main === module) {
  const csvPath = process.argv.find((a) => a.endsWith('.csv')) || DEFAULT_CSV;
  const bancos = parse(csvPath);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(bancos));
    process.exit(0);
  }
  console.log('Archivo:', csvPath);
  console.log('Bancos:', bancos.length);
  console.log('Con clave SAT:', bancos.filter((b) => b.clave_sat).length,
    '| sin clave:', bancos.filter((b) => !b.clave_sat).length);
  console.log('\nPrimeros 6:');
  bancos.slice(0, 6).forEach((b) => console.log(`  ${(b.clave_sat || '—').padEnd(4)} ${b.nombre_corto.padEnd(18)} ${b.razon_social}`));
  console.log('\nÚltimos 4:');
  bancos.slice(-4).forEach((b) => console.log(`  ${(b.clave_sat || '—').padEnd(4)} ${b.nombre_corto.padEnd(18)} ${b.razon_social}`));
}

module.exports = { parse };
