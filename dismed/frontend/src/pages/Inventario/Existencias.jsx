import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Search, Boxes } from 'lucide-react';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';

const fmtMXN = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const ESTADO = {
  CADUCADO:      { label: 'Caducado',  cls: 'bg-red-100 text-red-700' },
  ALERTA_30:     { label: '≤30 días',  cls: 'bg-red-50 text-red-600' },
  ALERTA_60:     { label: '≤60 días',  cls: 'bg-amber-100 text-amber-700' },
  ALERTA_90:     { label: '≤90 días',  cls: 'bg-yellow-50 text-yellow-700' },
  OK:            { label: 'Vigente',   cls: 'bg-green-50 text-green-700' },
  SIN_CADUCIDAD: { label: 'Sin cad.',  cls: 'bg-gray-100 text-gray-500' },
};

export default function Existencias() {
  const [q, setQ] = useState('');
  const [almacen, setAlmacen] = useState('');
  const [estado, setEstado] = useState('');

  const { data: almacenes = [] } = useQuery({
    queryKey: ['almacenes'], queryFn: () => api.get('/almacenes').then((r) => r.data),
  });
  const { data = [], isLoading } = useQuery({
    queryKey: ['existencias', q, almacen, estado],
    queryFn: () => api.get('/inventario/existencias', {
      params: { q: q || undefined, almacen_id: almacen || undefined, estado: estado || undefined },
    }).then((r) => r.data),
    keepPreviousData: true,
  });

  const valorTotal = data.reduce((a, r) => a + Number(r.valor || 0), 0);
  const unidadesTotal = data.reduce((a, r) => a + Number(r.cantidad_actual || 0), 0);

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(data);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Existencias</h1>
        <div className="flex gap-4 text-sm">
          <div className="text-right"><p className="text-xs text-gray-400">Renglones</p><p className="font-bold">{data.length}</p></div>
          <div className="text-right"><p className="text-xs text-gray-400">Unidades</p><p className="font-bold">{unidadesTotal.toLocaleString('es-MX')}</p></div>
          <div className="text-right"><p className="text-xs text-gray-400">Valor</p><p className="font-bold text-brand-600">{fmtMXN(valorTotal)}</p></div>
        </div>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar SKU o descripción…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-48" value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
          <option value="">Todos los almacenes</option>
          {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <select className="input w-44" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Toda caducidad</option>
          <option value="CADUCADO">Caducado</option>
          <option value="ALERTA_30">≤ 30 días</option>
          <option value="ALERTA_60">≤ 60 días</option>
          <option value="ALERTA_90">≤ 90 días</option>
          <option value="OK">Vigente</option>
          <option value="SIN_CADUCIDAD">Sin caducidad</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Boxes size={40} className="mx-auto text-gray-300 mb-3" />
            <p>Sin existencias.</p>
          </div>
        ) : (
          <table className="table-auto w-full text-sm">
            <thead>
              <tr>
                <th>SKU</th><th>Descripción</th><th>Almacén / Ubic.</th><th>Lote</th>
                <th>Caducidad</th><th className="text-right">Cantidad</th><th className="text-right">Costo</th><th className="text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => {
                const est = ESTADO[r.estado_caducidad] || ESTADO.SIN_CADUCIDAD;
                return (
                  <tr key={r.lote_id}>
                    <td className="font-mono text-xs text-brand-500">{r.sku_interno}</td>
                    <td className="max-w-md whitespace-normal break-words align-top">{r.descripcion}</td>
                    <td className="text-xs">{r.almacen || '—'}{r.ubicacion ? ` · ${r.ubicacion}` : ''}</td>
                    <td className="text-xs">
                      {r.es_generico ? <span className="text-gray-400">Genérico</span> : <span className="font-mono">{r.numero_lote}</span>}
                    </td>
                    <td className="text-xs">
                      <span className={`px-2 py-0.5 rounded-full ${est.cls}`}>{est.label}</span>
                      {r.fecha_caducidad && <span className="text-gray-400 ml-1">{r.fecha_caducidad}</span>}
                    </td>
                    <td className="text-right font-medium">{Number(r.cantidad_actual).toLocaleString('es-MX')} <span className="text-xs text-gray-400">{r.unidad_medida}</span></td>
                    <td className="text-right text-xs">{fmtMXN(r.costo_unitario)}</td>
                    <td className="text-right">{fmtMXN(r.valor)}</td>
                  </tr>
                );
              })}
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
