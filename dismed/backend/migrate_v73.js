/**
 * Migración v73 — node migrate_v73.js
 * Clientes con múltiples sucursales independientes.
 *
 * `clientes` pasa a ser la entidad FISCAL (RFC, razón social, régimen, crédito
 * consolidado). Cada sucursal (hospital, planta, oficina) vive en
 * `clientes_sucursales` con su nombre comercial, dirección de entrega y, si
 * aplica, su propio límite/días de crédito (NULL = hereda del cliente).
 *
 *  - clientes_sucursales             (nueva)
 *  - clientes_contactos.sucursal_id  (NULL = contacto corporativo) + area
 *  - sucursal_id (NULL permitido) en solicitudes, cotizaciones_cliente, pedidos,
 *    pedidos_cliente y entregas
 *  - clientes_skus.sucursal_id       (NULL = aplica a todo el cliente)
 *  - Backfill: una sucursal "Matriz" por cada cliente existente y los
 *    documentos históricos apuntan a ella.
 *
 * Idempotente. Nota: columnas FK con el mismo tipo que clientes.id
 * (INT UNSIGNED) para evitar errno 150.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

async function addColumn(tabla, col, ddl) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabla, col]
  );
  if (r.n) { console.log(`SKIP ${tabla}.${col} ya existe`); return; }
  await run(`${tabla}.${col}`, `ALTER TABLE \`${tabla}\` ADD COLUMN ${ddl}`);
}

async function existeTabla(t) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t]);
  return r.n > 0;
}

(async () => {
  await run('clientes_sucursales', `
    CREATE TABLE IF NOT EXISTS clientes_sucursales (
      id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
      cliente_id        INT UNSIGNED NOT NULL,
      nombre            VARCHAR(200) NOT NULL COMMENT 'Nombre comercial de la sucursal',
      clave             VARCHAR(30)  NULL     COMMENT 'Clave interna del cliente (ej. centro de costo)',
      es_matriz         TINYINT(1)   NOT NULL DEFAULT 0,
      direccion_entrega TEXT         NULL,
      codigo_postal     VARCHAR(5)   NULL,
      telefono          VARCHAR(30)  NULL,
      latitud           DECIMAL(10,7) NULL,
      longitud          DECIMAL(10,7) NULL,
      limite_credito    DECIMAL(14,2) NULL COMMENT 'NULL = sin tope propio (solo aplica el del cliente)',
      dias_credito      INT          NULL COMMENT 'NULL = hereda del cliente',
      notas             TEXT         NULL,
      activo            TINYINT(1)   NOT NULL DEFAULT 1,
      created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_suc_cliente (cliente_id),
      CONSTRAINT fk_suc_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id)
        ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await addColumn('clientes_contactos', 'sucursal_id', 'sucursal_id INT UNSIGNED NULL');
  await addColumn('clientes_contactos', 'area',
    "area VARCHAR(40) NULL COMMENT 'compras, contabilidad, recepcion, almacen, otro'");

  const tablasDoc = ['solicitudes', 'cotizaciones_cliente', 'pedidos', 'pedidos_cliente', 'entregas', 'clientes_skus'];
  for (const t of tablasDoc) {
    if (!(await existeTabla(t))) { console.log(`SKIP ${t} no existe`); continue; }
    await addColumn(t, 'sucursal_id', 'sucursal_id INT UNSIGNED NULL');
    await run(`${t} idx sucursal`, `ALTER TABLE \`${t}\` ADD INDEX idx_${t}_sucursal (sucursal_id)`);
    await run(`${t} fk sucursal`,
      `ALTER TABLE \`${t}\` ADD CONSTRAINT fk_${t}_sucursal FOREIGN KEY (sucursal_id)
         REFERENCES clientes_sucursales(id) ON UPDATE CASCADE`);
  }
  await run('clientes_contactos fk sucursal',
    `ALTER TABLE clientes_contactos ADD CONSTRAINT fk_contacto_sucursal FOREIGN KEY (sucursal_id)
       REFERENCES clientes_sucursales(id) ON UPDATE CASCADE`);

  // ── Backfill: una "Matriz" por cliente que no tenga sucursales ─────────────
  await run('backfill matriz', `
    INSERT INTO clientes_sucursales (cliente_id, nombre, es_matriz, direccion_entrega, codigo_postal)
    SELECT c.id, COALESCE(NULLIF(c.nombre_comercial, ''), c.razon_social), 1,
           c.direccion_fiscal, c.codigo_postal
      FROM clientes c
     WHERE NOT EXISTS (SELECT 1 FROM clientes_sucursales s WHERE s.cliente_id = c.id)
  `);
  // clientes_skus se queda en NULL: el diccionario aplica a todo el cliente.
  for (const t of tablasDoc.filter((x) => x !== 'clientes_skus')) {
    if (!(await existeTabla(t))) continue;
    await run(`backfill ${t}.sucursal_id`, `
      UPDATE \`${t}\` d
        JOIN clientes_sucursales s ON s.cliente_id = d.cliente_id AND s.es_matriz = 1
         SET d.sucursal_id = s.id
       WHERE d.sucursal_id IS NULL
    `);
  }

  console.log('\nMigración v73 terminada.');
  process.exit(0);
})();
