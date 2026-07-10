/**
 * Seed de catálogos de apoyo — node seed_inventario.js
 * Precarga familias / categorias_prod / subcategorias_prod / unidades_medida
 * desde seed_taxonomia.json (generado del CATALOGO MAESTRO.xlsx).
 *
 * Idempotente: usa INSERT ... ON DUPLICATE KEY UPDATE, así que se puede correr varias veces.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./src/config/db');

(async () => {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed_taxonomia.json'), 'utf8'));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let nFam = 0, nCat = 0, nSub = 0, nUni = 0;

    for (const fam of seed.taxonomia) {
      await conn.query(
        'INSERT INTO familias (nombre) VALUES (?) ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)',
        [fam.nombre]
      );
      const [[f]] = await conn.query('SELECT id FROM familias WHERE nombre = ?', [fam.nombre]);
      nFam++;

      for (const ca of fam.categorias) {
        await conn.query(
          `INSERT INTO categorias_prod (familia_id, nombre) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)`,
          [f.id, ca.nombre]
        );
        const [[c]] = await conn.query(
          'SELECT id FROM categorias_prod WHERE familia_id = ? AND nombre = ?', [f.id, ca.nombre]
        );
        nCat++;

        for (const su of ca.subcategorias) {
          await conn.query(
            `INSERT INTO subcategorias_prod (categoria_id, nombre) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)`,
            [c.id, su]
          );
          nSub++;
        }
      }
    }

    for (const u of seed.unidades) {
      await conn.query(
        `INSERT INTO unidades_medida (nombre, factor_sugerido) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE factor_sugerido = VALUES(factor_sugerido)`,
        [u.nombre, u.factor_sugerido]
      );
      nUni++;
    }

    await conn.commit();
    console.log(`Seed OK — familias=${nFam} categorias=${nCat} subcategorias=${nSub} unidades=${nUni}`);
  } catch (e) {
    await conn.rollback();
    console.error('ERROR seed:', e.message);
  } finally {
    conn.release();
    process.exit(0);
  }
})();
