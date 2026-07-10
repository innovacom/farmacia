import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import { exportarExcel, hoyISO } from '../../services/exportarExcel';

const ESTATUS_BADGE = {
  nueva:     'badge-blue',
  cotizando: 'badge-yellow',
  cotizada:  'badge-green',
  pedido:    'badge-green',
  cancelada: 'badge-red',
};

export default function SolicitudesList() {
  const [q, setQ] = useState('');
  const [fEstatus, setFEstatus] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['solicitudes'],
    queryFn: () => api.get('/solicitudes').then((r) => r.data),
  });

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.filter((s) =>
      (!fEstatus || s.estatus === fEstatus) &&
      (!t || `${s.folio} ${s.cliente}`.toLowerCase().includes(t))
    );
  }, [data, q, fEstatus]);

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(filtradas);

  async function exportar() {
    if (!filtradas.length) return toast.error('No hay renglones para exportar');
    await exportarExcel(`solicitudes_${hoyISO()}.xlsx`, 'Solicitudes', filtradas.map((s) => ({
      Folio:    s.folio,
      Cliente:  s.cliente,
      Origen:   s.tipo_origen,
      Partidas: s.num_partidas,
      Estatus:  s.estatus,
      Fecha:    new Date(s.created_at).toLocaleDateString('es-MX'),
    })));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Solicitudes</h1>
        <div className="flex gap-2">
          <button onClick={exportar} className="btn-secondary">
            <Download size={16} /> Exportar Excel
          </button>
          <Link to="/solicitudes/nueva" className="btn-primary">
            <Plus size={16} /> Nueva solicitud
          </Link>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por folio o cliente…"
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
            No hay solicitudes.{' '}
            <Link to="/solicitudes/nueva" className="text-brand-500 hover:underline">Crear la primera</Link>
          </p>
        ) : filtradas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Sin resultados con los filtros aplicados</p>
        ) : (
          <table className="table-auto w-full">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Cliente</th>
                <th>Origen</th>
                <th>Partidas</th>
                <th>Estatus</th>
                <th>Fecha</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-xs font-semibold text-brand-500">{s.folio}</td>
                  <td className="font-medium">{s.cliente}</td>
                  <td><span className="badge-gray capitalize">{s.tipo_origen}</span></td>
                  <td className="text-center">{s.num_partidas}</td>
                  <td>
                    <span className={ESTATUS_BADGE[s.estatus] || 'badge-gray'}>{s.estatus}</span>
                  </td>
                  <td className="text-gray-400 text-xs">
                    {new Date(s.created_at).toLocaleDateString('es-MX')}
                  </td>
                  <td>
                    <Link to={`/solicitudes/${s.id}`} className="text-xs text-brand-500 hover:underline">
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
