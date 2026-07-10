import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { ShoppingCart, Search, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import { exportarExcel, hoyISO } from '../../services/exportarExcel';

const BADGE = {
  abierto: 'badge-blue', surtido_parcial: 'badge-yellow', surtido: 'badge-green',
  entregado: 'badge-green', cerrado: 'badge-gray', cancelado: 'badge-red',
};

export default function PedidosList() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [fEstatus, setFEstatus] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['pedidos'], queryFn: () => api.get('/ventas/pedidos').then((r) => r.data),
  });

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.filter((p) =>
      (!fEstatus || p.estatus === fEstatus) &&
      (!t || `${p.folio} ${p.cliente} ${p.cotizacion_folio}`.toLowerCase().includes(t))
    );
  }, [data, q, fEstatus]);

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(filtrados);

  async function exportar() {
    if (!filtrados.length) return toast.error('No hay renglones para exportar');
    await exportarExcel(`pedidos_${hoyISO()}.xlsx`, 'Pedidos', filtrados.map((p) => ({
      Folio:      p.folio,
      Cliente:    p.cliente,
      Cotización: p.cotizacion_folio,
      Partidas:   p.partidas,
      Estatus:    p.estatus.replace('_', ' '),
      Fecha:      new Date(p.created_at).toLocaleDateString('es-MX'),
    })));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
        <button onClick={exportar} className="btn-secondary">
          <Download size={16} /> Exportar Excel
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por folio, cliente o cotización…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-44" value={fEstatus} onChange={(e) => setFEstatus(e.target.value)}>
          <option value="">Todos los estatus</option>
          {Object.keys(BADGE).map((e) => (
            <option key={e} value={e} className="capitalize">{e.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <ShoppingCart size={40} className="mx-auto text-gray-300 mb-3" />
            <p>Sin pedidos. Crea uno desde una cotización (botón «Asignación / Crear pedido»).</p>
          </div>
        ) : filtrados.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Sin resultados con los filtros aplicados</p>
        ) : (
          <table className="table-auto w-full text-sm">
            <thead>
              <tr><th>Folio</th><th>Cliente</th><th>Cotización</th><th className="text-center">Partidas</th><th className="text-center">Estatus</th><th>Fecha</th><th></th></tr>
            </thead>
            <tbody>
              {pageItems.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/ventas/pedidos/${p.id}`)}>
                  <td className="font-mono text-brand-500 font-semibold">{p.folio}</td>
                  <td>{p.cliente}</td>
                  <td className="font-mono text-xs text-gray-500">{p.cotizacion_folio}</td>
                  <td className="text-center">{p.partidas}</td>
                  <td className="text-center"><span className={BADGE[p.estatus] || 'badge-gray'}>{p.estatus.replace('_', ' ')}</span></td>
                  <td>{new Date(p.created_at).toLocaleDateString('es-MX')}</td>
                  <td>
                    <Link to={`/ventas/pedidos/${p.id}`} onClick={(e) => e.stopPropagation()}
                      className="text-xs text-brand-500 hover:underline">
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
