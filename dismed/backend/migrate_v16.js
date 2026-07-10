/**
 * Migración v16 — node migrate_v16.js
 * Fechas de precio + base de conocimientos de búsquedas web de precios.
 *
 * Objetivo: minimizar el uso de la búsqueda web (de pago histórico, hoy Gemini).
 * Antes de buscar en internet, el sistema consulta 1) el catálogo por proveedor y
 * 2) esta base de búsquedas web previas. Para saber qué precios siguen siendo
 * válidos se guarda la FECHA de cada precio; por defecto un precio es válido 11
 * meses (configurable con PRECIO_VIGENCIA_MESES).
 *
 *   1) proveedores_catalogo.fecha_precio (DATE)
 *      Fecha del precio de lista. Las filas existentes se rellenan con la fecha de hoy.
 *
 *   2) Tabla `precios_web_cache`
 *      Una fila por OFERTA encontrada en una búsqueda web. clave_busqueda = descripción
 *      normalizada (llave de recuperación); fecha_busqueda = cuándo se buscó.
 *
 * Idempotente: el ADD COLUMN se traga el error "Duplicate column" y el CREATE usa
 * IF NOT EXISTS, por lo que puede re-ejecutarse sin daño.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // 1) Fecha del precio en el catálogo por proveedor
  await run('proveedores_catalogo.fecha_precio (columna)', `
    ALTER TABLE proveedores_catalogo
      ADD COLUMN fecha_precio DATE NULL
      COMMENT 'Fecha del precio_lista; sirve para evaluar vigencia (def. 11 meses)'
      AFTER vigencia
  `);

  await run('proveedores_catalogo.fecha_precio (backfill a hoy)', `
    UPDATE proveedores_catalogo
       SET fecha_precio = CURDATE()
     WHERE fecha_precio IS NULL AND precio_lista IS NOT NULL
  `);

  // 2) Base de conocimientos de búsquedas web de precios
  await run('precios_web_cache (tabla)', `
    CREATE TABLE IF NOT EXISTS precios_web_cache (
      id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      clave_busqueda        VARCHAR(255)  NOT NULL
                            COMMENT 'Descripción normalizada usada como llave de recuperación',
      descripcion_original  VARCHAR(800)  NULL,
      codigo_cliente        VARCHAR(60)   NULL,
      codigo_gobierno       VARCHAR(60)   NULL,
      producto_identificado VARCHAR(400)  NULL
                            COMMENT 'identificacion.producto que devolvió la IA',
      referencia_fabricante VARCHAR(80)   NULL,
      clave_cuadro_basico   VARCHAR(60)   NULL,

      tienda                VARCHAR(150)  NOT NULL,
      url                   VARCHAR(700)  NOT NULL,
      precio_mxn            DECIMAL(12,2) NOT NULL,
      notas                 VARCHAR(500)  NULL,
      moneda                CHAR(3)       NOT NULL DEFAULT 'MXN',

      fecha_busqueda        DATE          NOT NULL
                            COMMENT 'Cuándo se realizó la búsqueda; def. válido 11 meses',
      created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (id),
      KEY idx_pwc_clave  (clave_busqueda, fecha_busqueda),
      KEY idx_pwc_codgob (codigo_gobierno),
      KEY idx_pwc_codcli (codigo_cliente),
      KEY idx_pwc_ref    (referencia_fabricante)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Caché de búsquedas web de precios (evita repetir búsquedas IA/web)'
  `);

  console.log('\nMigración v16 terminada.');
  process.exit(0);
})();
