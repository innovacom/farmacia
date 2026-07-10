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

/** Fecha corta para nombres de archivo: 2026-07-02 */
export function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
