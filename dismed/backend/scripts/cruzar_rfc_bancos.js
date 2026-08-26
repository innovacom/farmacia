/**
 * cruzar_rfc_bancos.js — Cruza el catálogo de bancos (SAT/Banxico, participantes
 * SPEI, sin RFC) contra los RFC REALES que aparecen en cfdi_repositorio (CFDI
 * timbrados de verdad, el RFC ahí es autoritativo — lo validó el PAC/SAT al
 * timbrar). Para cada banco del catálogo, busca coincidencias de nombre entre
 * los emisores que le han facturado algo a DISMED y reporta el/los RFC
 * encontrados, para revisión manual antes de guardarlos en bancos.rfc.
 *
 *   node scripts/cruzar_rfc_bancos.js [--guardar]
 *
 * Sin --guardar: solo imprime el reporte (dry-run).
 * Con --guardar: además hace UPDATE bancos SET rfc=... para los matches con
 * UN SOLO rfc_emisor distinto (ambiguos con más de un RFC no se guardan solos,
 * se listan para decidir a mano).
 */
require('dotenv').config();
const { pool } = require('../src/config/db');

// Catálogo oficial (SAT/Banxico, "Instituciones bancarias participantes SPEI
// para depósito de Devoluciones", ago-2019) — nombre_corto : término(s) de
// búsqueda distintivo(s) para matchear contra cfdi_repositorio.nombre_emisor.
const BANCOS = {
  BANCOMEXT: ['BANCO NACIONAL DE COMERCIO EXTERIOR'],
  BANOBRAS: ['BANOBRAS', 'BANCO NACIONAL DE OBRAS'],
  BANJERCITO: ['BANJERCITO', 'BANCO NACIONAL DEL EJERCITO'],
  NAFIN: ['NACIONAL FINANCIERA'],
  BANSEFI: ['BANSEFI', 'BANCO DEL AHORRO NACIONAL'],
  'HIPOTECARIA FED': ['HIPOTECARIA FEDERAL'],
  BANAMEX: ['BANAMEX', 'BANCO NACIONAL DE MEXICO'],
  'BBVA BANCOMER': ['BBVA'],
  SANTANDER: ['SANTANDER'],
  HSBC: ['HSBC'],
  BAJIO: ['BANCO DEL BAJIO'],
  INBURSA: ['INBURSA'],
  MIFEL: ['MIFEL'],
  SCOTIABANK: ['SCOTIABANK'],
  BANREGIO: ['BANREGIO', 'BANCO REGIONAL'],
  INVEX: ['INVEX'],
  BANSI: ['BANSI'],
  AFIRME: ['AFIRME'],
  'BANORTE/IXE': ['BANORTE', 'IXE'],
  'ACCENDO BANCO': ['ACCENDO'],
  'AMERICAN EXPRES': ['AMERICAN EXPRESS'],
  'BANK OF AMERICA': ['BANK OF AMERICA'],
  MUFG: ['MUFG'],
  'JP MORGAN': ['JP MORGAN', 'JPMORGAN'],
  BMONEX: ['BANCO MONEX', 'MONEX GRUPO FINANCIERO'],
  'VE POR MAS': ['VE POR MAS'],
  DEUTSCHE: ['DEUTSCHE BANK'],
  'CREDIT SUISSE': ['CREDIT SUISSE'],
  AZTECA: ['BANCO AZTECA'],
  AUTOFIN: ['AUTOFIN'],
  BARCLAYS: ['BARCLAYS'],
  COMPARTAMOS: ['COMPARTAMOS'],
  'BANCO FAMSA': ['BANCO AHORRO FAMSA', 'BANCO FAMSA'],
  'MULTIVA BANCO': ['BANCO MULTIVA'],
  ACTINVER: ['ACTINVER'],
  'INTERCAM BANCO': ['INTERCAM BANCO'],
  BANCOPPEL: ['BANCOPPEL'],
  'ABC CAPITAL': ['ABC CAPITAL'],
  CONSUBANCO: ['CONSUBANCO'],
  VOLKSWAGEN: ['VOLKSWAGEN BANK'],
  CIBANCO: ['CIBANCO'],
  BBASE: ['BANCO BASE'],
  BANKAOOL: ['BANKAOOL'],
  PAGATODO: ['BANCO PAGATODO'],
  DONDE: ['DONDE BANCO', 'FUNDACION DONDE'],
  BANCREA: ['BANCO BANCREA'],
  ICBC: ['ICBC', 'INDUSTRIAL AND COMMERCIAL BANK OF CHINA'],
  SABADELL: ['BANCO SABADELL'],
  STP: ['SISTEMA DE TRANSFERENCIAS Y PAGOS STP', ' STP,'],
};

async function buscar(term) {
  const [rows] = await pool.query(
    `SELECT DISTINCT rfc_emisor, nombre_emisor FROM cfdi_repositorio
      WHERE tipo='recibido' AND UPPER(nombre_emisor) LIKE ?`,
    [`%${term}%`]);
  return rows;
}

(async () => {
  const guardar = process.argv.includes('--guardar');
  const resultados = [];

  for (const [corto, terminos] of Object.entries(BANCOS)) {
    const encontrados = new Map(); // rfc -> nombre_emisor
    for (const t of terminos) {
      const rows = await buscar(t);
      for (const r of rows) encontrados.set(r.rfc_emisor, r.nombre_emisor);
    }
    if (encontrados.size) {
      resultados.push({ corto, rfcs: [...encontrados.entries()] });
    }
  }

  console.log(`\n=== Bancos del catálogo SAT/Banxico que SÍ le han facturado a DISMED ===`);
  for (const r of resultados) {
    console.log(`\n${r.corto}:`);
    for (const [rfc, nombre] of r.rfcs) console.log(`   ${rfc}  ${nombre}`);
  }
  console.log(`\nTotal bancos con match: ${resultados.length} de ${Object.keys(BANCOS).length} buscados`);

  if (guardar) {
    let actualizados = 0, ambiguos = 0;
    for (const r of resultados) {
      if (r.rfcs.length !== 1) { ambiguos++; continue; } // más de un RFC — no se guarda solo
      const [rfc] = r.rfcs[0];
      const [res] = await pool.query(
        "UPDATE bancos SET rfc=? WHERE nombre_corto LIKE ? OR razon_social LIKE ?",
        [rfc, `%${r.corto}%`, `%${r.corto}%`]);
      if (res.affectedRows) actualizados++;
    }
    console.log(`\nGuardado: ${actualizados} bancos actualizados en la tabla 'bancos'. Ambiguos (más de 1 RFC, no guardados): ${ambiguos}`);
  } else {
    console.log('\n(dry-run — corre con --guardar para escribir en bancos.rfc)');
  }
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
