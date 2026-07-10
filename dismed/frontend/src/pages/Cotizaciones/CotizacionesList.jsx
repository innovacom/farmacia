import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import { exportarExcel, hoyISO } from '../../services/exportarExcel';

const ESTATUS_BADGE = {
  borrador:  'badge-gray',
  enviada:   'badge-blue',
  aceptada:  'badge-green',
  rechazada: 'badge-red',
  vencida:   'badge-yellow',
};

const fmt = (n) =>
  Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export default function CotizacionesList() {
  const [q, setQ] = useState('');
  const [fEstatus, setFEstatus] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['cotizaciones'],
    queryFn: () => api.get('/cotizaciones-cliente').then((r) => r.data),
  });

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.filter((c) =>
      (!fEstatus || c.estatus === fEstatus) &&
      (!t || `${c.folio} ${c.cliente} ${c.folio_solicitud}`.toLowerCase().includes(t))
    );
  }, [data, q, fEstatus]);

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(filtradas);

  async function exportar() {
    if (!filtradas.length) return toast.error('No hay renglones para exportar');
    await exportarExcel(`cotizaciones_${hoyISO()}.xlsx`, 'Cotizaciones', filtradas.map((c) => ({
      Folio:     c.folio,
      Cliente:   c.cliente,
      Solicitud: c.folio_solicitud,
      Total:     Number(c.total),
      Estatus:   c.estatus,
      Fecha:     new Date(c.created_at).toLocaleDateString('es-MX'),
    })));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Cotizaciones al cliente</h1>
        <button onClick={exportar} className="btn-secondary">
          <Download size={16} /> Exportar Excel
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por folio, cliente o solicitud…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-44" value={fEstatus} onChange={(e) => setFEstatus(e.target.value)}>
          <option value="">Todos los estatus</option>
          {Object.keys(ESTATUS_BADGE).map((e) => (
            <option key={e} value={e} className="capitalize">{e}</option>
          ))}
        </select>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">
            No hay cotizaciones aún. Genera una desde el{' '}
            <Link to="/solicitudes" className="text-brand-500 hover:underline">
              comparador de precios
            </Link>.
          </p>
        ) : filtradas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Sin resultados con los filtros aplicados</p>
        ) : (
          <table className="table-auto w-full">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Cliente</th>
                <th>Solicitud</th>
                <th className="text-right">Total</th>
                <th>Estatus</th>
                <th>Fecha</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs font-semibold text-brand-500">{c.folio}</td>
                  <td className="font-medium">{c.cliente}</td>
                  <td className="font-mono text-xs text-gray-500">{c.folio_solicitud}</td>
                  <td className="text-right font-medium">{fmt(c.total)}</td>
                  <td>
                    <span className={ESTATUS_BADGE[c.estatus] || 'badge-gray'}>{c.estatus}</span>
                  </td>
                  <td className="text-gray-400 text-xs">
                    {new Date(c.created_at).toLocaleDateString('es-MX')}
                  </td>
                  <td>
                    <Link to={`/cotizaciones/${c.id}`} className="text-xs text-brand-500 hover:underline">
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!isLoading && (
          <Pagination page={page} totalPages={totalPages} total={total} from={from} to={to} onChange={setPage} />
        )}
      </div>
    </div>
  );
}
