/* Prueba del endpoint de configuración contra la BD local (requiere migrate_v17 y migrate_v67). */
require('dotenv').config();
const { pool } = require('./src/config/db');
const ctrl = require('./src/modules/configuracion/configuracion.controller');
const precios = require('./src/config/precios');
const cobertura = require('./src/config/cobertura');

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('  OK  ' + m); } else { fail++; console.error('  FAIL ' + m); } };

// res falso para capturar la respuesta del controller
function fakeRes() {
  return { _status: 200, _json: null,
    status(s) { this._status = s; return this; },
    json(j) { this._json = j; return this; } };
}
const run = (fn, req) => new Promise((resolve) => { const res = fakeRes(); Promise.resolve(fn(req, res, (e) => { res._err = e; resolve(res); })).then(() => resolve(res)); });

(async () => {
  try {
    // estado inicial (defaults del seed)
    const v0 = await precios.getVigencias();
    assert(v0.vigencia_catalogo_meses === 11, 'default catálogo = 11');
    assert(v0.vigencia_web_meses === 4, 'default web = 4');

    // GET
    const g = await run(ctrl.get, {});
    assert(g._json && g._json.vigencia_web_meses === 4, 'GET devuelve web=4');

    // PUT válido: cambiar web a 6
    const p = await run(ctrl.update, { body: { vigencia_web_meses: 6 } });
    assert(p._status === 200 && p._json.vigencia_web_meses === 6, 'PUT web=6 OK');
    const vCache = await precios.getVigencias();
    assert(vCache.vigencia_web_meses === 6, 'cache en memoria refleja web=6');
    const [[row]] = await pool.query("SELECT valor FROM configuracion WHERE clave='vigencia_web_meses'");
    assert(row.valor === '6', 'BD persistió web=6');

    // PUT inválido: fuera de rango
    const bad = await run(ctrl.update, { body: { vigencia_catalogo_meses: 999 } });
    assert(bad._status === 400, 'PUT 999 rechazado con 400');

    // restaurar a 4
    await run(ctrl.update, { body: { vigencia_web_meses: 4 } });
    const vFin = await precios.getVigencias();
    assert(vFin.vigencia_web_meses === 4, 'restaurado web=4');

    // radio_cobertura_km (default del seed en migrate_v67)
    const r0 = await cobertura.getRadioCoberturaKm();
    assert(r0 === 2, 'default radio_cobertura_km = 2');

    const g2 = await run(ctrl.get, {});
    assert(g2._json && g2._json.radio_cobertura_km === 2, 'GET incluye radio_cobertura_km=2');

    // PUT válido con decimales
    const pr = await run(ctrl.update, { body: { radio_cobertura_km: 3.5 } });
    assert(pr._status === 200 && pr._json.radio_cobertura_km === 3.5, 'PUT radio=3.5 OK');
    const rCache = await cobertura.getRadioCoberturaKm();
    assert(rCache === 3.5, 'cache en memoria refleja radio=3.5');
    const [[rowR]] = await pool.query("SELECT valor FROM configuracion WHERE clave='radio_cobertura_km'");
    assert(rowR.valor === '3.5', 'BD persistió radio=3.5');

    // PUT inválido: fuera de rango
    const badR = await run(ctrl.update, { body: { radio_cobertura_km: 999 } });
    assert(badR._status === 400, 'PUT radio=999 rechazado con 400');

    // restaurar a 2
    await run(ctrl.update, { body: { radio_cobertura_km: 2 } });
    const rFin = await cobertura.getRadioCoberturaKm();
    assert(rFin === 2, 'restaurado radio=2');

    console.log(`\nResultado: ${ok} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  } catch (e) { console.error('ERROR inesperado:', e); process.exit(1); }
})();
