/**
 * Exporta un arreglo de objetos a un .xlsx descargado en el navegador.
 * xlsx se carga con import dinámico para no engordar el bundle inicial:
 * solo se descarga la primera vez que alguien exporta.
 *
 * @param {string} nombreArchivo  ej. "solicitudes_2026-07-02.xlsx"
 * @param {string} hoja           nombre de la pestaña
 * @param {Array<object>} filas   objetos planos; las llaves son los encabezados
 */
export async function exportarExcel(nombreArchivo, hoja, filas) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja);
  XLSX.writeFile(wb, nombreArchivo);
}

/**
 * Exporta un arreglo de objetos a un .csv descargado en el navegador (con BOM
 * UTF-8 para que Excel en Windows abra acentos/ñ correctamente).
 *
 * @param {string} nombreArchivo  ej. "ventas_producto_2026-08-10.csv"
 * @param {Array<object>} filas   objetos planos; las llaves son los encabezados
 */
export async function exportarCsv(nombreArchivo, filas) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(filas);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fecha corta para nombres de archivo: 2026-07-02 */
export function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
