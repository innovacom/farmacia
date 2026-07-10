---
name: migracion
description: Crea el siguiente migrate_vN.js idempotente siguiendo el patrón del repo DISMED, a partir de los cambios de esquema que pidas. Invocar con /migracion.
disable-model-invocation: true
---

# /migracion — Nueva migración de esquema DISMED

Genera el siguiente `migrate_vN.js` en `dismed/backend/` con el patrón establecido. **Solo usuario** (escribe un archivo que altera la BD de producción).

## Pasos

1. **Detectar la última versión.** Busca `dismed/backend/migrate_v*.js` y toma el N mayor. La nueva es `migrate_v{N+1}.js`.

2. **Recoger el cambio.** Pregunta al usuario qué tablas/columnas/índices se agregan o modifican (o dedúcelo del trabajo en curso).

3. **Generar el archivo** con esta plantilla exacta:

   ```js
   /**
    * Migración v{N+1} — node migrate_v{N+1}.js
    * <descripción corta del cambio y por qué>
    * Idempotente.
    */
   require('dotenv').config();
   const { pool } = require('./src/config/db');

   async function run(label, sql) {
     try { await pool.query(sql); console.log('OK  ' + label); }
     catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
   }

   (async () => {
     await run('<tabla>.<columna>', `
       ALTER TABLE <tabla>
         ADD COLUMN IF NOT EXISTS <columna> <tipo> NULL COMMENT '<motivo>' AFTER <col>`);
     // ...más cambios...
     console.log('\nMigración v{N+1} terminada.');
     process.exit(0);
   })();
   ```

## Reglas (MariaDB en producción)

- **Idempotente siempre:** `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`. El helper `run()` además captura errores para que reejecutar no falle.
- `rows` es palabra reservada en MariaDB: no la uses como nombre de columna.
- RFC ≤ 13, decimales fiscales según columna (p.ej. `factor_ganancia` es `decimal(5,4)`, máx 9.9999).
- Folios vía `sp_generar_folio(serie)`; SKUs vía `sp_generar_sku()`.
- No toques `productos`/`proveedores`/`usuarios` salvo que el cambio lo pida explícitamente.

4. **Recordar correrla:** dile al usuario que se ejecuta en el VPS con `/deploy` (paso de migración) o manualmente `cd /var/www/dismed/backend && sudo node migrate_v{N+1}.js`. NO la corras tú contra producción sin que el usuario lo pida.
