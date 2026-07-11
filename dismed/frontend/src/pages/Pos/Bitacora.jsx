import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pill, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';

const CLASIF = {
  antibiotico: 'Antibiótico',
  fraccion_i: 'Fracción I',
  fraccion_ii: 'Fracción II',
  fraccion_iii: 'Fracción III',
};

const lotesTexto = (lotes_json) => {
  const lotes = typeof lotes_json === 'string' ? JSON.parse(lotes_json || '[]') : (lotes_json || []);
  return lotes.map((l) =>
    `${l.lote}${l.caducidad ? ` (cad ${String(l.caducidad).slice(0, 10)})` : ''} ×${Number(l.cantidad)}`
  ).join('; ');
};

/**
 * Bitácora COFEPRIS de antibióticos y controlados (permiso pos-bitacora).
 * Es una vista sobre las partidas vendidas (snapshots + lotes del FEFO):
 * no puede desincronizarse de las ventas. Exportable a Excel para auditoría.
 */
export default function Bitacora() {
  const [filtros, setFiltros] = useState({ desde: '', hasta: '', clasificacion: '', sucursal_id: '' });
  const set = (k, v) => setFiltros((f) => ({ ...f, [k]: v }));

  const { data = [], isLoading } = useQuery({
    queryKey: ['pos-bitacora', filtros],
    queryFn: () => api.get('/pos/bitacora', {
      params: Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)),
    }).then((r) => r.data),
  });

  const { data: sucursales = [] } = useQuery({
    queryKey: ['pos-sucursales'],
    queryFn: () => api.get('/pos/sucursales').then((r) => r.data).catch(() => []),
  });

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(data);

  function exportarExcel() {
    const wb = XLSX.utils.book_new();
    // Una hoja por clasificación (antibióticos y cada fracción por separado)
    const grupos = {};
    for (const r of data) (grupos[r.clasificacion_cofepris] ||= []).push(r);
    for (const [clasif, filas] of Object.entries(grupos)) {
      const hoja = filas.map((r) => ({
        'Fecha y hora': new Date(r.fecha).toLocaleString('es-MX'),
        'Folio ticket': r.ticket,
        Sucursal: r.sucursal,
        Producto: r.producto,
        'Sustancia activa': r.sustancia_activa || '',
        Clasificación: CLASIF[r.clasificacion_cofepris] || r.clasificacion_cofepris,
        Cantidad: Number(r.cantidad),
        'Lote(s) y caducidad': lotesTexto(r.lotes_json),
        'Folio receta': r.folio_receta || '',
        'Fecha receta': r.fecha_receta ? String(r.fecha_receta).slice(0, 10) : '',
        Médico: r.medico || '',
        'Cédula profesional': r.cedula_profesional || '',
        Paciente: r.paciente_nombre || '',
        'Domicilio paciente': r.paciente_domicilio || '',
        'Receta retenida': r.retenida ? 'Sí' : 'No',
        'Nº surtimiento': r.surtimiento || '',
        Dispensó: r.dispenso,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hoja),
        (CLASIF[clasif] || clasif).slice(0, 31));
    }
    if (!Object.keys(grupos).length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'Sin registros');
    }
    XLSX.writeFile(wb, `bitacora_cofepris_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Pill size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Bitácora COFEPRIS</h1>
        </div>
        <button className="btn-primary" onClick={exportarExcel} disabled={isLoading}>
          <FileSpreadsheet size={16} /> Exportar Excel
        </button>
      </div>

      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Desde</label>
          <input type="date" className="input" value={filtros.desde} onChange={(e) => set('desde', e.target.value)} />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input type="date" className="input" value={filtros.hasta} onChange={(e) => set('hasta', e.target.value)} />
        </div>
        <div>
          <label className="label">Clasificación</label>
          <select className="input" value={filtros.clasificacion} onChange={(e) => set('clasificacion', e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(CLASIF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Sucursal</label>
          <select className="input" value={filtros.sucursal_id} onChange={(e) => set('sucursal_id', e.target.value)}>
            <option value="">Todas</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>Fecha</th><th>Ticket</th><th>Producto</th><th>Clasif.</th>
              <th className="text-center">Cant.</th><th>Lote / caducidad</th>
              <th>Receta</th><th>Médico</th><th>Paciente</th><th>Dispensó</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((r, i) => (
              <tr key={`${r.ticket}-${i}`}>
                <td className="whitespace-nowrap">{new Date(r.fecha).toLocaleString('es-MX')}</td>
                <td className="font-mono text-xs">{r.ticket}</td>
                <td>
                  {r.producto}
                  {r.sustancia_activa && <p className="text-xs text-gray-400">{r.sustancia_activa}</p>}
                </td>
                <td><span className="badge-yellow">{CLASIF[r.clasificacion_cofepris] || r.clasificacion_cofepris}</span></td>
                <td className="text-center">{Number(r.cantidad)}</td>
                <td className="text-xs">{lotesTexto(r.lotes_json)}</td>
                <td className="text-xs">
                  {r.folio_receta || 's/folio'}
                  {r.retenida ? <span className="badge-green ml-1">Retenida</span> : null}
                </td>
                <td className="text-xs">{r.medico}<p className="text-gray-400 font-mono">{r.cedula_profesional}</p></td>
                <td className="text-xs">{r.paciente_nombre}</td>
                <td className="text-xs">{r.dispenso}</td>
              </tr>
            ))}
            {!pageItems.length && (
              <tr><td colSpan={10} className="text-center text-gray-400 py-8">
                {isLoading ? 'Cargando…' : 'Sin registros en el periodo'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} from={from} to={to} />
    </div>
  );
}
