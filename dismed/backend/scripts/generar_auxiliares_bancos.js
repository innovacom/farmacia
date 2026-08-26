/**
 * generar_auxiliares_bancos.js — Genera de una vez el tercer nivel (auxiliar)
 * de la cuenta 701.10 Comisiones bancarias para TODOS los bancos del catálogo
 * `bancos` que ya tienen RFC (ver scripts/cargar_bancos_rfc_oficial.js).
 *
 * Normalmente el auxiliar se crea solo (lazy) la primera vez que ese banco le
 * factura algo a DISMED, vía polizas.generator.js/aplicarNivelDetalle. Este
 * script lo adelanta para TODO el catálogo, no solo los bancos que ya han
 * facturado — así el nivel de detalle queda listo de antemano (pedido del
 * usuario: "genera el nivel tercer de detalle de las cuentas contables de
 * bancos"). Usa la clave SAT/Banxico (identificador oficial en SPEI) en el
 * nombre del auxiliar para que sea reconocible sin cruzar tablas.
 *
 *   node scripts/generar_auxiliares_bancos.js
 *
 * Idempotente: resolverAuxiliar es get-or-create por RFC (migrate_v65), correr
 * de nuevo no duplica nada — solo agrega los bancos nuevos que no tenían RFC.
 */
require('dotenv').config();
const { pool } = require('../src/config/db');
const { CTA } = require('../src/modules/contabilidad/polizas.cuentas');
const { resolverAuxiliar } = require('../src/modules/contabilidad/cuentas.auxiliares');

(async () => {
  const [bancos] = await pool.query(
    "SELECT id, clave_sat, nombre_corto, rfc FROM bancos WHERE rfc IS NOT NULL AND rfc<>'' ORDER BY clave_sat");

  const cache = new Map();
  let creados = 0, existentes = 0;
  for (const b of bancos) {
    const nombre = b.clave_sat ? `${b.nombre_corto} (${b.clave_sat})` : b.nombre_corto;
    const [[antes]] = await pool.query(
      "SELECT COUNT(*) n FROM cuentas_auxiliares WHERE rfc=? AND cuenta_padre=?",
      [b.rfc.toUpperCase().trim(), CTA.COMISIONES_BANCARIAS]);
    const codigo = await resolverAuxiliar(pool, {
      cuentaPadre: CTA.COMISIONES_BANCARIAS, entidadTipo: 'proveedor', entidadId: null,
      rfc: b.rfc, nombre,
    }, cache);
    if (Number(antes.n) > 0) existentes++; else creados++;
    console.log(`${codigo}  ${nombre}  (${b.rfc})`);
  }

  console.log(`\nListo: ${creados} auxiliares nuevos, ${existentes} ya existían. Total bancos con RFC: ${bancos.length}.`);
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
