/**
 * Importador de catálogo/tarifario y equivalencias → proveedores_catalogo (CLI).
 * Delega en el servicio compartido src/modules/herramientas/herramientas.service.js
 * (misma lógica que las pantallas web Herramientas → Importar/Exportar).
 *
 *   node import_pronamac_cli.js <archivo.xlsx> [opciones]
 *
 * Opciones:
 *   --tipo=catalogo|equivalencias   Layout del archivo (default: catalogo)
 *   --vigencia="JUNIO 2026"         Vigencia por defecto (solo catálogo, si la fila no la trae)
 *   --dry-run                       No toca la BD; sólo previsualiza columnas y estadísticas
 *
 * El PROVEEDOR ya NO se pasa por bandera: cada renglón lo trae en su columna PROVEEDOR
 * (nombre o ID). Se resuelve/crea por archivo, así un mismo archivo puede traer varios.
 *
 * Layouts (encabezados, tolerante a acentos/mayúsculas/espacios):
 *   Catálogo:      PROVEEDOR | SKU PROVEEDOR | DESCRIPCION | REFERENCIA FABRICANTE | UNIDAD MEDIDA | PRECIO | [VIGENCIA]
 *   Equivalencias: PROVEEDOR | SKU PROVEEDOR | SKU INNOVACOM
 */
require('dotenv').config();
const path = require('path');
const svc = require('./src/modules/herramientas/herramientas.service');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const DRY = args.includes('--dry-run');
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=').replace(/^"|"$/g, '').trim() : def;
};
const TIPO = opt('tipo', 'catalogo');
const VIGENCIA = opt('vigencia', null);

if (!file) {
  console.error('Uso: node import_pronamac_cli.js <archivo.xlsx> [--tipo=catalogo|equivalencias] [--vigencia="JUNIO 2026"] [--dry-run]');
  process.exit(1);
}

(async () => {
  const ruta = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  console.log(`Archivo: ${ruta}`);
  console.log(`Tipo: ${TIPO} | Vigencia por defecto: ${VIGENCIA || '(la del archivo)'}`);

  try {
    if (DRY) {
      const pv = await svc.previsualizar(ruta, TIPO);
      console.log('\n--dry-run (no toca la BD).');
      console.log('Columnas detectadas:');
      for (const c of pv.columnas) {
        const estado = c.presente ? `OK → "${c.encabezado_detectado}"` : (c.requerido ? 'FALTA (obligatoria)' : 'ausente (opcional)');
        console.log(`  ${c.etiqueta.padEnd(26)} ${estado}`);
      }
      if (pv.faltantes.length) console.log('\n⚠ Faltan columnas obligatorias:', pv.faltantes.join(', '));
      console.log('\nEstadísticas:', JSON.stringify(pv.stats));
      console.log('Muestra:');
      for (const f of pv.muestra) console.log('  ', JSON.stringify(f));
      process.exit(0);
    }

    const resultado = TIPO === 'catalogo'
      ? await svc.importarCatalogo(ruta, { vigenciaDefault: VIGENCIA })
      : await svc.importarEquivalencias(ruta);
    console.log('\nImportación OK:', JSON.stringify(resultado, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
