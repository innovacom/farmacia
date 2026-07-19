import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Search, Check, Tags } from 'lucide-react';
import api from '../../services/api';
import { usePrefsStore } from '../../store/prefsStore';
import Pagination from '../../components/ui/Pagination';

// Convierte "12,50" o "12.50" a número; '' → null (sin tope / sin definir).
function aNumero(str) {
  if (str === '' || str == null) return null;
  const n = parseFloat(String(str).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function FilaProducto({ p, onSaved }) {
  const [precioLista, setPrecioLista]     = useState(p.precio_lista != null ? String(p.precio_lista) : '');
  const [precioPublico, setPrecioPublico] = useState(p.precio_publico != null ? String(p.precio_publico) : '');
  const [vendible, setVendible]           = useState(!!p.vendible);

  const dirty =
    precioLista !== (p.precio_lista != null ? String(p.precio_lista) : '') ||
    precioPublico !== (p.precio_publico != null ? String(p.precio_publico) : '');

  const guardarMut = useMutation({
    mutationFn: (payload) => api.patch(`/productos/${p.id}/venta`, payload),
    onSuccess: () => { toast.success('Actualizado'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  function guardarPrecios() {
    const lista = aNumero(precioLista);
    const publico = aNumero(precioPublico);
    if (lista == null) return toast.error('Precio de lista requerido');
    if (publico != null && publico > 0 && lista > publico)
      return toast.error('El precio de lista no puede ser mayor al precio público (disposición legal)');
    guardarMut.mutate({ precio_lista: lista, precio_publico: publico });
  }

  function toggleVendible() {
    const nuevo = !vendible;
    setVendible(nuevo);
    api.patch(`/productos/${p.id}/venta`, { vendible: nuevo })
      .then(() => { toast.success('Actualizado'); onSaved(); })
      .catch((e) => { setVendible(!nuevo); toast.error(e.response?.data?.error || 'Error al guardar'); });
  }

  return (
    <tr className={!p.activo ? 'opacity-50' : ''}>
      <td className="font-mono text-xs font-semibold text-brand-500">{p.sku_interno}</td>
      <td className="max-w-md">
        <p className="font-medium">{p.descripcion}</p>
        {p.fabricante && <p className="text-xs text-gray-400">{p.fabricante}</p>}
      </td>
      <td className="text-right">
        <input
          type="text" inputMode="decimal"
          className="input text-right w-28 tabular-nums"
          value={precioLista}
          onChange={(e) => setPrecioLista(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') guardarPrecios(); }}
        />
      </td>
      <td className="text-right">
        <input
          type="text" inputMode="decimal"
          className="input text-right w-28 tabular-nums"
          placeholder="Sin tope"
          value={precioPublico}
          onChange={(e) => setPrecioPublico(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') guardarPrecios(); }}
        />
      </td>
      <td className="text-center">
        <input
          type="checkbox"
          className="h-4 w-4 accent-brand-500"
          checked={vendible}
          onChange={toggleVendible}
          title="Vendible en POS y cotizaciones"
        />
      </td>
      <td className="text-center">
        <button
          onClick={guardarPrecios}
          disabled={!dirty || guardarMut.isPending}
          className="text-brand-500 hover:text-brand-600 disabled:text-gray-300"
          title="Guardar precios"
        >
          {guardarMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        </button>
      </td>
    </tr>
  );
}

export default function PreciosVenta() {
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState('');
  const [busquedaDeb, setBusquedaDeb] = useState('');
  const [estatus, setEstatus] = useState('activos');
  const [page, setPage] = useState(0);
  const pageSize = usePrefsStore((s) => s.rowsPerPage);

  useEffect(() => { setPage(0); }, [pageSize, estatus]);
  useEffect(() => {
    const t = setTimeout(() => { setBusquedaDeb(busqueda); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const { data, isLoading } = useQuery({
    queryKey: ['productos-venta', busquedaDeb, estatus, page, pageSize],
    queryFn: () => api.get('/productos', {
      params: { q: busquedaDeb || undefined, estatus, limit: pageSize, offset: page * pageSize },
    }).then((r) => r.data),
    keepPreviousData: true,
  });

  const pageItems  = data?.rows || [];
  const total      = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function refrescar() { qc.invalidateQueries(['productos-venta']); }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Tags size={22} className="text-brand-500" /> Precios y estatus de venta
        </h1>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por SKU o descripción…"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <select className="input w-40" value={estatus} onChange={(e) => setEstatus(e.target.value)}>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : total === 0 ? (
          <div className="text-center py-12">
            <Tags size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">No se encontraron productos</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-auto w-full text-sm">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Descripción</th>
                  <th className="text-right">P. Lista</th>
                  <th className="text-right">P. Público</th>
                  <th className="text-center">Vendible</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => (
                  <FilaProducto key={p.id} p={p} onSaved={refrescar} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && (
          <Pagination
            page={page + 1}
            totalPages={totalPages}
            total={total}
            from={total === 0 ? 0 : page * pageSize + 1}
            to={Math.min((page + 1) * pageSize, total)}
            onChange={(p) => setPage(p - 1)}
          />
        )}
      </div>
    </div>
  );
}
