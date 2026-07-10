import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Loader2, Landmark, Search } from 'lucide-react';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import CuentaContableSelect from '../../components/shared/CuentaContableSelect';

const FORM_VACIO = {
  clave_sat: '', nombre_corto: '', razon_social: '', descripcion: '',
  cuenta_contable_codigo: '', activo: 1,
};

export default function Bancos() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [busqueda, setBusqueda] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['bancos', busqueda],
    queryFn: () => api.get('/bancos', { params: { q: busqueda || undefined } }).then((r) => r.data),
    keepPreviousData: true,
  });

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(data);

  const guardarMut = useMutation({
    mutationFn: (payload) =>
      editando ? api.put(`/bancos/${editando.id}`, payload) : api.post('/bancos', payload),
    onSuccess: () => {
      toast.success(editando ? 'Banco actualizado' : 'Banco creado');
      qc.invalidateQueries(['bancos']);
      cerrar();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  function abrirNuevo() { setEditando(null); setForm(FORM_VACIO); setShowModal(true); }
  function abrirEditar(b) {
    setEditando(b);
    setForm({
      clave_sat: b.clave_sat || '', nombre_corto: b.nombre_corto || '',
      razon_social: b.razon_social || '', descripcion: b.descripcion || '',
      cuenta_contable_codigo: b.cuenta_contable_codigo || '', activo: b.activo ?? 1,
    });
    setShowModal(true);
  }
  function cerrar() { setShowModal(false); setEditando(null); setForm(FORM_VACIO); }
  function set(campo, valor) { setForm((f) => ({ ...f, [campo]: valor })); }

  function submit(e) {
    e.preventDefault();
    if (!form.nombre_corto?.trim()) return toast.error('Nombre corto requerido');
    guardarMut.mutate({
      ...form,
      clave_sat: form.clave_sat || null,
      cuenta_contable_codigo: form.cuenta_contable_codigo || null,
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Landmark size={22} className="text-brand-500" /> Bancos
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Catálogo de bancos del SAT. Asigna una descripción y la cuenta contable a los que utilices.
          </p>
        </div>
        <button onClick={abrirNuevo} className="btn-primary"><Plus size={16} /> Nuevo banco</button>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-80" placeholder="Buscar clave, nombre o descripción…"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : (
          <table className="table-auto w-full text-sm">
            <thead>
              <tr>
                <th className="w-20">Clave</th>
                <th>Banco</th>
                <th>Descripción</th>
                <th>Cuenta contable</th>
                <th className="text-center w-20">Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((b) => (
                <tr key={b.id} className={b.activo ? '' : 'opacity-50'}>
                  <td className="font-mono text-xs text-gray-500">{b.clave_sat || '—'}</td>
                  <td>
                    <p className="font-medium text-gray-800">{b.nombre_corto}</p>
                    {b.razon_social && <p className="text-xs text-gray-400">{b.razon_social}</p>}
                  </td>
                  <td className="text-gray-600">{b.descripcion || <span className="text-gray-300">—</span>}</td>
                  <td>
                    {b.cuenta_contable_codigo ? (
                      <span className="text-xs">
                        <span className="font-mono text-gray-500">{b.cuenta_contable_codigo}</span>
                        {b.cuenta_nombre && <span className="text-gray-500"> · {b.cuenta_nombre}</span>}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-center">
                    {b.activo ? <span className="badge-green text-xs">Activo</span> : <span className="badge-gray text-xs">Inactivo</span>}
                  </td>
                  <td>
                    <button onClick={() => abrirEditar(b)} className="text-xs text-brand-500 hover:underline">Editar</button>
                  </td>
                </tr>
              ))}
              {pageItems.length === 0 && (
                <tr><td colSpan={6} className="text-center text-gray-400 py-8">Sin bancos</td></tr>
              )}
            </tbody>
          </table>
        )}
        {!isLoading && (
          <Pagination page={page} totalPages={totalPages} total={total} from={from} to={to} onChange={setPage} />
        )}
      </div>

      {showModal && (
        <Modal title={editando ? 'Editar banco' : 'Nuevo banco'} onClose={cerrar}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Clave SAT</label>
                <input className="input font-mono" maxLength={5} placeholder="012"
                  value={form.clave_sat} onChange={(e) => set('clave_sat', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="label">Nombre corto *</label>
                <input className="input" value={form.nombre_corto} onChange={(e) => set('nombre_corto', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Razón social</label>
              <input className="input" value={form.razon_social} onChange={(e) => set('razon_social', e.target.value)} />
            </div>
            <div>
              <label className="label">Descripción (uso interno)</label>
              <input className="input" placeholder="p. ej. Cuenta operativa BBVA ****1234"
                value={form.descripcion} onChange={(e) => set('descripcion', e.target.value)} />
            </div>
            <div>
              <label className="label">Cuenta contable</label>
              <CuentaContableSelect
                value={form.cuenta_contable_codigo}
                onChange={(v) => set('cuenta_contable_codigo', v)}
                rubro="Activo"
                placeholder="Sin asignar (p. ej. 102 Bancos)"
              />
            </div>
            {editando && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-brand-500"
                  checked={!!form.activo} onChange={(e) => set('activo', e.target.checked ? 1 : 0)} />
                Activo
              </label>
            )}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={guardarMut.isPending} className="btn-primary">
                {guardarMut.isPending && <Loader2 size={15} className="animate-spin" />}
                {editando ? 'Guardar cambios' : 'Crear banco'}
              </button>
              <button type="button" onClick={cerrar} className="btn-secondary">Cancelar</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
