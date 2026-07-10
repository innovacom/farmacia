/**
 * legacy_load.js — FASE 2 de la importación histórica (corre en el VPS).
 *
 * Lee los JSON generados por legacy_extract.js (backend/data/legacy/) y los carga
 * en las tablas VIVAS de dismed_db. Cada cotización antigua se convierte en:
 *   cotizacion_encabezado  → solicitudes (1) + cotizaciones_cliente (1)
 *   cotizacion_Detalle     → solicitudes_partidas (N) + cotizaciones_cliente_partidas (N)
 *   cotizacion_detalle_proveedor → cotizaciones_proveedor (1xproveedor) + _precios (N)
 *
 * Mapeos:
 *   clientes   : old.cliente id → live.id (match por RFC único; si no, se crea)
 *   usuarios   : old.elaboro id → live.usuarios.id (match por email)
 *   proveedores: nombre string normalizado → live.proveedores.id (se crea activo=0)
 *
 * Folios: SOL/COT-{año de fecha}-{num cotización a 4 dígitos}, conservando el
 * número legacy para trazabilidad. Al final ajusta la tabla `folios`.
 *
 * Uso:
 *   node scripts/legacy_load.js                 # carga todo
 *   node scripts/legacy_load.js --limit 25      # solo las primeras 25 (prueba)
 *   node scripts/legacy_load.js --dir /tmp/legacy
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

const args = process.argv.slice(2);
const getArg = (k, def) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const LIMIT = parseInt(getArg('--limit', '0'), 10) || 0;
const DIR = getArg('--dir', path.join(__dirname, '..', 'data', 'legacy'));

const load = (name) => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));

// ---- helpers -------------------------------------------------------------
const num = (v) => (v == null || v === '' ? 0 : Number(v));
const orNull = (v) => (v == null || v === '' ? null : v);
// Recorta a la longitud de la columna destino; '' → null.
const cut = (v, n) => { const s = (v == null ? '' : String(v)).trim(); return s ? s.slice(0, n) : null; };
const yearOf = (dt) => (dt ? parseInt(String(dt).slice(0, 4), 10) : new Date().getFullYear());
const folio = (serie, yr, n) => `${serie}-${yr}-${String(n).padStart(4, '0')}`;
const normName = (s) => (s || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');

const ESTATUS_COT = { GENERADA: 'enviada', NUEVA: 'borrador' };

(async () => {
  const enc = load('cotizacion_encabezado').sort((a, b) => a.cotizacion - b.cotizacion);
  const detAll = load('cotizacion_detalle');
  const dpAll = load('cotizacion_detalle_proveedor');
  const oldClientes = load('clientes');
  const oldUsuarios = load('usuarios');

  // Index detalle / detalle_proveedor por cotización
  const detByCot = new Map();
  for (const d of detAll) {
    if (!detByCot.has(d.cotizacion)) detByCot.set(d.cotizacion, []);
    detByCot.get(d.cotizacion).push(d);
  }
  const dpByCot = new Map();
  for (const d of dpAll) {
    if (!dpByCot.has(d.cotizacion)) dpByCot.set(d.cotizacion, []);
    dpByCot.get(d.cotizacion).push(d);
  }

  const conn = await pool.getConnection();
  try {
    // ---- 1. Mapa de usuarios live (email → id) ----
    const [liveUsers] = await conn.query('SELECT id, LOWER(email) AS email FROM usuarios');
    const emailToUserId = new Map(liveUsers.map((u) => [u.email, u.id]));
    const oldUserEmail = new Map(oldUsuarios.map((u) => [u.id, (u.correo || '').toLowerCase()]));
    const mapUser = (oldId) => emailToUserId.get(oldUserEmail.get(oldId)) || null;

    // ---- 2. Mapa de clientes (old.cliente → live.id), 1:1 SIN fusionar ----
    // Cada cliente legacy = una sucursal independiente con sus cotizaciones.
    // El RFC puede repetirse entre sucursales (requiere índice NO único; ver
    // migrate_clientes_rfc_no_unique.js).
    const cliMap = new Map();
    for (const c of oldClientes) {
      const razon = c.sucursal || `CLIENTE ${c.cliente}`;
      const rfcRaw = (c.rfc || '').trim().toUpperCase();
      const rfc = rfcRaw.length === 12 || rfcRaw.length === 13 ? rfcRaw : null;
      const [r] = await conn.query(
        `INSERT INTO clientes (razon_social, nombre_comercial, rfc, direccion_fiscal, tipo_cliente, notas)
         VALUES (?,?,?,?, 'otro', ?)`,
        [razon, orNull(c.sucursal_corta), rfc, orNull(c.direccion),
         `Importado del sistema anterior — cliente/sucursal legacy #${c.cliente}`]
      );
      cliMap.set(c.cliente, r.insertId);
    }

    // ---- 3. Mapa de proveedores (nombre normalizado → live.id), lazy + cache ----
    const [liveProv] = await conn.query('SELECT id, UPPER(nombre_empresa) AS n FROM proveedores');
    const provMap = new Map(liveProv.map((p) => [p.n, p.id]));
    async function getProvId(name) {
      const key = normName(name);
      if (!key) return null;
      if (provMap.has(key)) return provMap.get(key);
      const [r] = await conn.query(
        'INSERT INTO proveedores (nombre_empresa, activo, notas) VALUES (?, 0, ?)',
        [name.trim().slice(0, 200), 'legacy (auto)']
      );
      provMap.set(key, r.insertId);
      return r.insertId;
    }

    // ---- 4. Recorrer cotizaciones ----
    const subset = LIMIT ? enc.slice(0, LIMIT) : enc;
    const folioMax = {}; // { 'COT-2024': maxNum }
    let okCot = 0, partidas = 0, precios = 0, preciosSkip = 0;

    for (const h of subset) {
      const yr = yearOf(h.fecha);
      const n = h.cotizacion;
      const cliId = cliMap.get(h.cliente);
      const dets = (detByCot.get(n) || []).sort((a, b) => a.partida - b.partida);
      const dps = dpByCot.get(n) || [];
      // factor_ganancia destino es decimal(5,4) (máx 9.9999); fuera de rango → null
      const fg = h.factor_ganancia == null || h.factor_ganancia === '' ? null : Number(h.factor_ganancia);
      const factorSafe = fg != null && fg >= 0 && fg <= 9.9999 ? fg : null;

      await conn.beginTransaction();
      try {
        // 4a. solicitud
        const [sol] = await conn.query(
          `INSERT INTO solicitudes
             (folio, cliente_id, referencia_cliente, atencion, concepto, factor_ganancia,
              tipo_origen, estatus, notas, created_at)
           VALUES (?,?,?,?,?,?, 'manual', 'cotizada', ?, ?)`,
          [folio('SOL', yr, n), cliId, cut(h.solicitud_cliente, 100), cut(h.solicito, 150),
           cut(h.descripcion, 200), factorSafe,
           `Importado del sistema anterior — cotización legacy #${n}`, h.fecha]
        );
        const solId = sol.insertId;

        // 4b. solicitudes_partidas  (mapa: partida legacy → id live)
        const partMap = new Map();
        let subtotal = 0, ivaTot = 0;
        for (const d of dets) {
          const obs = [orNull(d.observacion_cliente), d.ean ? `EAN:${d.ean}` : null]
            .filter(Boolean).join(' | ') || null;
          const [sp] = await conn.query(
            `INSERT INTO solicitudes_partidas
               (solicitud_id, linea, codigo_cliente, codigo_gobierno, descripcion_original,
                cantidad, unidad_medida, observaciones, match_estado)
             VALUES (?,?,?,?,?,?,?,?, 'sin_vincular')`,
            [solId, d.partida, orNull(d.clave_cliente), orNull(d.codigo_gobierno),
             (d.descripcion || '(sin descripción)').slice(0, 1000),
             num(d.cantidad_solicitada) || 1, (d.unidad_medida || 'pza').slice(0, 30), obs]
          );
          partMap.set(d.partida, sp.insertId);
          subtotal += num(d.Precio_referencia) * num(d.cantidad_solicitada);
          ivaTot += num(d.iva);
          partidas++;
        }
        const total = subtotal + ivaTot;

        // 4c. cotizaciones_cliente
        let vig = 10;
        if (h.fecha && h.vigencia) {
          const d = Math.round((new Date(h.vigencia) - new Date(h.fecha)) / 86400000);
          vig = Math.min(255, Math.max(0, d || 10));
        }
        const notasCot = [`Importado del sistema anterior — cotización legacy #${n}`,
          h.autorizo ? `Autorizó (id legacy): ${h.autorizo}` : null].filter(Boolean).join('. ');
        const [cot] = await conn.query(
          `INSERT INTO cotizaciones_cliente
             (folio, concepto, solicitud_id, cliente_id, atencion, elaborado_por_id,
              subtotal, iva, total, dias_vigencia, estatus, notas, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [folio('COT', yr, n), cut(h.descripcion, 200), solId, cliId, cut(h.solicito, 150),
           mapUser(h.elaboro), subtotal.toFixed(2), ivaTot.toFixed(2), total.toFixed(2),
           vig, ESTATUS_COT[h.estatus] || 'enviada', notasCot, h.fecha]
        );
        const cotId = cot.insertId;

        // 4d. cotizaciones_cliente_partidas
        for (const d of dets) {
          const cant = num(d.cantidad_solicitada) || 1;
          const pv = num(d.Precio_referencia);
          const margen = factorSafe != null ? factorSafe * 100 : 0;
          await conn.query(
            `INSERT INTO cotizaciones_cliente_partidas
               (cotizacion_id, partida_solicitud_id, sku_interno, codigo_cliente, linea,
                descripcion, cantidad, unidad_medida, precio_compra, margen_pct,
                precio_unitario_venta, importe, iva_exento)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [cotId, partMap.get(d.partida) || null, cut(d.codigo_innovacom, 20),
             cut(d.clave_cliente, 80), d.partida,
             (d.descripcion || '(sin descripción)').slice(0, 1000), cant,
             (d.unidad_medida || 'pza').slice(0, 30), num(d.precio_compra),
             Math.min(999.99, margen).toFixed(2), pv.toFixed(2), (pv * cant).toFixed(2),
             num(d.iva) === 0 && pv > 0 ? 1 : 0]
          );
        }

        // 4e. cotizaciones_proveedor (1 por nombre de proveedor) + precios
        const provCot = new Map(); // provIdLive → cotizaciones_proveedor.id
        for (const dp of dps) {
          const provId = await getProvId(dp.proveedor);
          if (!provId) continue;
          let cpId = provCot.get(provId);
          if (!cpId) {
            try {
              const [cp] = await conn.query(
                `INSERT INTO cotizaciones_proveedor
                   (solicitud_id, proveedor_id, estatus, fecha_solicitud, fecha_respuesta)
                 VALUES (?,?, 'recibida', ?, ?)`,
                [solId, provId, h.fecha, h.fecha]
              );
              cpId = cp.insertId;
            } catch (e) {
              if (e.code === 'ER_DUP_ENTRY') {
                const [[ex]] = await conn.query(
                  'SELECT id FROM cotizaciones_proveedor WHERE solicitud_id=? AND proveedor_id=?',
                  [solId, provId]
                );
                cpId = ex.id;
              } else throw e;
            }
            provCot.set(provId, cpId);
          }
          const partId = partMap.get(dp.partida);
          if (!partId) { preciosSkip++; continue; } // precio de una partida inexistente
          try {
            await conn.query(
              `INSERT INTO cotizaciones_proveedor_precios
                 (cotizacion_proveedor_id, partida_id, observaciones_proveedor, precio_unitario, disponible)
               VALUES (?,?,?,?,1)`,
              [cpId, partId, orNull(dp.observaciones_proveedor), orNull(dp.precio_cotizado)]
            );
            precios++;
          } catch (e) {
            if (e.code !== 'ER_DUP_ENTRY') throw e; // un proveedor cotizó la misma partida 2x
          }
        }

        await conn.commit();
        okCot++;
        folioMax[`COT-${yr}`] = Math.max(folioMax[`COT-${yr}`] || 0, n);
        folioMax[`SOL-${yr}`] = Math.max(folioMax[`SOL-${yr}`] || 0, n);
        if (okCot % 250 === 0) console.log(`  ... ${okCot}/${subset.length} cotizaciones`);
      } catch (e) {
        await conn.rollback();
        console.error(`ERROR cotización legacy #${n}: ${e.code || ''} ${e.message}`);
      }
    }

    // ---- 5. Ajustar folios para que los consecutivos nuevos no choquen ----
    for (const [k, maxN] of Object.entries(folioMax)) {
      const [serie, yr] = k.split('-');
      await conn.query(
        `INSERT INTO folios (serie, anio, ultimo) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE ultimo = GREATEST(ultimo, VALUES(ultimo))`,
        [serie, parseInt(yr, 10), maxN]
      );
    }

    console.log(`\nCARGA COMPLETA:
  cotizaciones: ${okCot}/${subset.length}
  partidas:     ${partidas}
  precios prov: ${precios} (omitidos por partida inexistente: ${preciosSkip})
  proveedores en mapa: ${provMap.size}
  clientes en mapa:    ${cliMap.size}`);
  } catch (e) {
    console.error('FALLO GLOBAL:', e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})();
