import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Loader2, Layers } from 'lucide-react';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';

const TABS = [
  { key: 'familias',      label: 'Familias' },
  { key: 'categorias',    label: 'Categorías' },
  { key: 'subcategorias', label: 'Subcategorías' },
  { key: 'unidades',      label: 'Unidades de medida' },
];

export default function CatalogosApoyo() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('familias');
  const [familiaSel, setFamiliaSel] = useState('');
  const [categoriaSel, setCategoriaSel] = useState('');
  const [nuevo, setNuevo] = useState('');
  const [factor, setFactor] = useState('');

  const familias = useQuery({ queryKey: ['familias'], queryFn: () => api.get('/catalogos/familias').then((r) => r.data) });
  const categorias = useQuery({
    queryKey: ['categorias', familiaSel],
    queryFn: () => api.get('/catalogos/categorias', { params: { familia_id: familiaSel } }).then((r) => r.data),
    enabled: tab === 'categorias' || tab === 'subcategorias',
  });
  const subcategorias = useQuery({
    queryKey: ['subcategorias', categoriaSel],
    queryFn: () => api.get('/catalogos/subcategorias', { params: { categoria_id: categoriaSel } }).then((r) => r.data),
    enabled: tab === 'subcategorias' && !!categoriaSel,
  });
  const unidades = useQuery({ queryKey: ['unidades'], queryFn: () => api.get('/catalogos/unidades').then((r) => r.data) });

  const crearMut = useMutation({
    mutationFn: (payload) => api.post(`/catalogos/${payload.endpoint}`, payload.body),
    onSuccess: () => {
      toast.success('Agregado');
      setNuevo(''); setFactor('');
      qc.invalidateQueries(['familias']); qc.invalidateQueries(['categorias']);
      qc.invalidateQueries(['subcategorias']); qc.invalidateQueries(['unidades']);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  function agregar() {
    if (!nuevo.trim()) return toast.error('Escribe un nombre');
    if (tab === 'familias') crearMut.mutate({ endpoint: 'familias', body: { nombre: nuevo } });
    if (tab === 'categorias') {
      if (!familiaSel) return toast.error('Selecciona una familia');
      crearMut.mutate({ endpoint: 'categorias', body: { familia_id: familiaSel, nombre: nuevo } });
    }
    if (tab === 'subcategorias') {
      if (!categoriaSel) return toast.error('Selecciona una categoría');
      crearMut.mutate({ endpoint: 'subcategorias', body: { categoria_id: categoriaSel, nombre: nuevo } });
    }
    if (tab === 'unidades') crearMut.mutate({ endpoint: 'unidades', body: { nombre: nuevo, factor_sugerido: factor === '' ? null : parseFloat(factor) } });
  }

  const lista = {
    familias: familias.data || [],
    categorias: categorias.data || [],
    subcategorias: subcategorias.data || [],
    unidades: unidades.data || [],
  }[tab];

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(lista);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Catálogos de apoyo</h1>
      <p className="text-sm text-gray-500 mb-5">Mantenimiento de la taxonomía de productos y unidades de medida.</p>

      <div className="flex gap-2 mb-5 flex-wrap">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors
              ${tab === t.key ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Selectores de contexto para categorías/subcategorías */}
      {(tab === 'categorias' || tab === 'subcategorias') && (
        <div className="flex gap-3 mb-4 flex-wrap">
          <select className="input w-60" value={familiaSel}
            onChange={(e) => { setFamiliaSel(e.target.value); setCategoriaSel(''); }}>
            <option value="">— Familia —</option>
            {(familias.data || []).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
          {tab === 'subcategorias' && (
            <select className="input w-60" value={categoriaSel} disabled={!familiaSel}
              onChange={(e) => setCategoriaSel(e.target.value)}>
              <option value="">— Categoría —</option>
              {(categorias.data || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          )}
        </div>
      )}

      {/* Agregar */}
      <div className="card flex items-end gap-3 mb-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Nuevo {TABS.find((t) => t.key === tab).label.toLowerCase().replace(/s$/, '')}</label>
          <input className="input" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Nombre…" />
        </div>
        {tab === 'unidades' && (
          <div className="w-40">
            <label className="label">Factor (pzas)</label>
            <input type="number" className="input" value={factor} onChange={(e) => setFactor(e.target.value)} placeholder="opcional" />
          </div>
        )}
        <button onClick={agregar} disabled={crearMut.isPending} className="btn-primary">
          {crearMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Agregar
        </button>
      </div>

      {/* Lista */}
      <div className="card">
        {lista.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Layers size={36} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">Sin registros{(tab === 'categorias' && !familiaSel) ? ' — selecciona una familia' : ''}{(tab === 'subcategorias' && !categoriaSel) ? ' — selecciona una categoría' : ''}.</p>
          </div>
        ) : (
          <table className="table-auto w-full text-sm">
            <thead>
              <tr>
                <th>Nombre</th>
                {tab === 'unidades' && <th className="text-right">Factor</th>}
                {tab === 'categorias' && <th>Familia</th>}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((it) => (
                <tr key={it.id}>
                  <td className="font-medium">{it.nombre}</td>
                  {tab === 'unidades' && <td className="text-right">{it.factor_sugerido ?? '—'}</td>}
                  {tab === 'categorias' && <td className="text-gray-500">{it.familia_nombre}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} totalPages={totalPages} total={total} from={from} to={to} onChange={setPage} />
      </div>
    </div>
  );
}
