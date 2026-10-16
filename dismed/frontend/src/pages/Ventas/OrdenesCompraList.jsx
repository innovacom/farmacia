import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { FileText, Search, Download, PackageCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import { exportarExcel, hoyISO } from '../../services/exportarExcel';

const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const BADGE = { abierta: 'badge-blue', parcial: 'badge-yellow', recibida: 'badge-green', cancelada: 'badge-red' };

export default function OrdenesCompraList() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [fEstatus, setFEstatus] = useState('');
  const [fProveedor, setFProveedor] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['ordenes-compra'], queryFn: () => api.get('/ventas/ordenes-compra').then((r) => r.data),
  });

  const proveedores = useMemo(() => {
    const vistos = new Map();
    data.forEach((oc) => vistos.set(oc.proveedor_id, oc.proveedor));
    return [...vistos.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.filter((oc) =>
      (!fEstatus || oc.estatus === fEstatus) &&
      (!fProveedor || String(oc.proveedor_id) === fProveedor) &&
      (!t || `${oc.folio} ${oc.proveedor} ${oc.pedido_folio}`.toLowerCase().includes(t))
    );
  }, [data, q, fEstatus, fProveedor]);

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(filtrados);

  async function exportar() {
    if (!filtrados.length) return toast.error('No hay renglones para exportar');
    await exportarExcel(`ordenes_compra_${hoyISO()}.xlsx`, 'Órdenes de compra', filtrados.map((oc) => ({
      Folio: oc.folio,
      Proveedor: oc.proveedor,
      Pedido: oc.pedido_folio,
      Partidas: oc.partidas,
      Total: oc.total,
      Estatus: oc.estatus,
      Fecha: new Date(oc.created_at).toLocaleDateString('es-MX'),
    })));
  }

  async function verPdf(ocId) { const { data } = await api.get(`/ventas/ordenes-compra/${ocId}/pdf`); if (data.url) window.open(data.url, '_blank'); }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Órdenes de compra</h1>
        <button onClick={exportar} className="btn-secondary">
          <Download size={16} /> Exportar Excel
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por folio, proveedor o pedido…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-44" value={fEstatus} onChange={(e) => setFEstatus(e.target.value)}>
          <option value="">Todos los estatus</option>
          {Object.keys(BADGE).map((e) => (
            <option key={e} value={e} className="capitalize">{e}</option>
          ))}
        </select>
        <select className="input w-56" value={fProveedor} onChange={(e) => setFProveedor(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {proveedores.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
        </select>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <FileText size={40} className="mx-auto text-gray-300 mb-3" />
            <p>Sin órdenes de compra. Se generan desde el detalle de un pedido («Generar órdenes de compra»).</p>
          </div>
        ) : filtrados.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Sin resultados con los filtros aplicados</p>
        ) : (
          <table className="table-auto w-full text-sm">
            <thead>
              <tr><th>Folio</th><th>Proveedor</th><th>Pedido</th><th className="text-center">Partidas</th><th className="text-right">Total</th><th className="text-center">Estatus</th><th>Fecha</th><th></th></tr>
            </thead>
            <tbody>
              {pageItems.map((oc) => (
                <tr key={oc.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/ventas/pedidos/${oc.pedido_id}`)}>
                  <td className="font-mono text-brand-500 font-semibold">{oc.folio}</td>
                  <td>{oc.proveedor}</td>
                  <td className="font-mono text-xs text-gray-500">{oc.pedido_folio}</td>
                  <td className="text-center">{oc.partidas}</td>
                  <td className="text-right">{fmt(oc.total)}</td>
                  <td className="text-center"><span className={BADGE[oc.estatus] || 'badge-gray'}>{oc.estatus}</span></td>
                  <td>{new Date(oc.created_at).toLocaleDateString('es-MX')}</td>
                  <td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => verPdf(oc.id)} className="text-xs text-gray-500 hover:text-brand-500 mr-3"><Download size={14} className="inline" /> PDF</button>
                    <Link to={`/ventas/pedidos/${oc.pedido_id}`} className="text-xs text-brand-500 hover:underline"><PackageCheck size={14} className="inline" /> Ver pedido</Link>
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
