import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Loader2, Layers, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const TABS = [
  { key: 'familias',      label: 'Familias',              endpoint: 'familias' },
  { key: 'categorias',    label: 'Categorías',             endpoint: 'categorias' },
  { key: 'subcategorias', label: 'Subcategorías',          endpoint: 'subcategorias' },
  { key: 'unidades',      label: 'Unidades de medida',     endpoint: 'unidades' },
];

export default function CatalogosApoyo() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const [tab, setTab] = useState('familias');
  const [familiaSel, setFamiliaSel] = useState('');
  const [categoriaSel, setCategoriaSel] = useState('');
  const [estatus, setEstatus] = useState('activos');
  const [nuevo, setNuevo] = useState('');
  const [factor, setFactor] = useState('');
  const [editando, setEditando] = useState(null); // { nombre, factor_sugerido, ...item }

  const familias = useQuery({
    queryKey: ['familias', estatus],
    queryFn: () => api.get('/catalogos/familias', { params: { estatus } }).then((r) => r.data),
  });
  const categorias = useQuery({
    queryKey: ['categorias', familiaSel, estatus],
    queryFn: () => api.get('/catalogos/categorias', { params: { familia_id: familiaSel, estatus } }).then((r) => r.data),
    enabled: tab === 'categorias' || tab === 'subcategorias',
  });
  const subcategorias = useQuery({
    queryKey: ['subcategorias', categoriaSel, estatus],
    queryFn: () => api.get('/catalogos/subcategorias', { params: { categoria_id: categoriaSel, estatus } }).then((r) => r.data),
    enabled: tab === 'subcategorias' && !!categoriaSel,
  });
  const unidades = useQuery({
    queryKey: ['unidades', estatus],
    queryFn: () => api.get('/catalogos/unidades', { params: { estatus } }).then((r) => r.data),
  });

  function invalidarTodo() {
    qc.invalidateQueries(['familias']); qc.invalidateQueries(['categorias']);
    qc.invalidateQueries(['subcategorias']); qc.invalidateQueries(['unidades']);
  }

  const crearMut = useMutation({
    mutationFn: (payload) => api.post(`/catalogos/${payload.endpoint}`, payload.body),
    onSuccess: () => { toast.success('Agregado'); setNuevo(''); setFactor(''); invalidarTodo(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const editarMut = useMutation({
    mutationFn: ({ endpoint, id, body }) => api.put(`/catalogos/${endpoint}/${id}`, body),
    onSuccess: () => { toast.success('Actualizado'); setEditando(null); invalidarTodo(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const bajaMut = useMutation({
    mutationFn: ({ endpoint, id }) => api.delete(`/catalogos/${endpoint}/${id}`),
    onSuccess: () => { toast.success('Dado de baja'); invalidarTodo(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al dar de baja'),
  });

  const reactivarMut = useMutation({
    mutationFn: ({ endpoint, id }) => api.put(`/catalogos/${endpoint}/${id}`, { activo: 1 }),
    onSuccess: () => { toast.success('Reactivado'); invalidarTodo(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al reactivar'),
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

  const endpointActual = TABS.find((t) => t.key === tab).endpoint;

  function abrirEditar(item) {
    setEditando({ ...item, _nombre: item.nombre, _factor: item.factor_sugerido ?? '' });
  }

  function guardarEdicion() {
    if (!editando._nombre?.trim()) return toast.error('Escribe un nombre');
    const body = { nombre: editando._nombre };
    if (tab === 'unidades') body.factor_sugerido = editando._factor === '' ? null : parseFloat(editando._factor);
    editarMut.mutate({ endpoint: endpointActual, id: editando.id, body });
  }

  async function darDeBaja(item) {
    const ok = await confirmar(`¿Dar de baja "${item.nombre}"?`, { titulo: 'Dar de baja', textoConfirmar: 'Dar de baja' });
    if (!ok) return;
    bajaMut.mutate({ endpoint: endpointActual, id: item.id });
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

      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors
                ${tab === t.key ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <select className="input w-40" value={estatus} onChange={(e) => setEstatus(e.target.value)}>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="todos">Todos</option>
        </select>
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
                <th className="text-center">Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((it) => (
                <tr key={it.id} className={!it.activo ? 'opacity-50' : ''}>
                  <td className="font-medium">{it.nombre}</td>
                  {tab === 'unidades' && <td className="text-right">{it.factor_sugerido ?? '—'}</td>}
                  {tab === 'categorias' && <td className="text-gray-500">{it.familia_nombre}</td>}
                  <td className="text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${it.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {it.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => abrirEditar(it)} className="text-xs text-brand-500 hover:underline">Editar</button>
                      {it.activo ? (
                        <button onClick={() => darDeBaja(it)} className="text-xs text-red-400 hover:text-red-600" title="Dar de baja">
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <button onClick={() => reactivarMut.mutate({ endpoint: endpointActual, id: it.id })} className="text-xs text-green-600 hover:underline">
                          Reactivar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} totalPages={totalPages} total={total} from={from} to={to} onChange={setPage} />
      </div>

      {editando && (
        <Modal title={`Editar ${TABS.find((t) => t.key === tab).label.toLowerCase().replace(/s$/, '')}`} onClose={() => setEditando(null)}>
          <div className="space-y-4">
            <div>
              <label className="label">Nombre</label>
              <input className="input" value={editando._nombre} onChange={(e) => setEditando({ ...editando, _nombre: e.target.value })} />
            </div>
            {tab === 'unidades' && (
              <div>
                <label className="label">Factor (pzas)</label>
                <input type="number" className="input" value={editando._factor} onChange={(e) => setEditando({ ...editando, _factor: e.target.value })} />
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={guardarEdicion} disabled={editarMut.isPending} className="btn-primary">
                {editarMut.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Guardar cambios
              </button>
              <button onClick={() => setEditando(null)} className="btn-secondary">Cancelar</button>
            </div>
          </div>
        </Modal>
      )}

      {dialogoConfirm}
    </div>
  );
}
