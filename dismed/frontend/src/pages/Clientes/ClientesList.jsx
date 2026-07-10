import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Loader2, Building2, Search } from 'lucide-react';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import CuentaContableSelect from '../../components/shared/CuentaContableSelect';

const TIPOS = ['hospital', 'clinica', 'farmacia', 'laboratorio', 'gobierno', 'otro'];

export default function ClientesList() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [ctaCobrar, setCtaCobrar] = useState('');
  const [q, setQ] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => api.get('/clientes').then((r) => r.data),
  });

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return data;
    return data.filter((c) =>
      `${c.razon_social} ${c.nombre_comercial || ''} ${c.rfc || ''}`.toLowerCase().includes(t)
    );
  }, [data, q]);

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(filtrados);

  const { register, handleSubmit, reset, formState: { errors } } = useForm();

  const guardarMut = useMutation({
    mutationFn: (data) => {
      const payload = { ...data, cuenta_cobrar_codigo: ctaCobrar || null };
      return editando
        ? api.put(`/clientes/${editando.id}`, payload)
        : api.post('/clientes', payload);
    },
    onSuccess: () => {
      toast.success(editando ? 'Cliente actualizado' : 'Cliente creado');
      qc.invalidateQueries(['clientes']);
      setShowModal(false);
      setEditando(null);
      reset();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const desactivarMut = useMutation({
    mutationFn: (id) => api.delete(`/clientes/${id}`),
    onSuccess: () => { toast.success('Cliente desactivado'); qc.invalidateQueries(['clientes']); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al desactivar'),
  });

  const reactivarMut = useMutation({
    mutationFn: (id) => api.put(`/clientes/${id}`, { activo: 1 }),
    onSuccess: () => { toast.success('Cliente reactivado'); qc.invalidateQueries(['clientes']); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al reactivar'),
  });

  async function desactivar(c) {
    const ok = await confirmar(
      `¿Desactivar al cliente "${c.razon_social}"? No aparecerá en nuevas solicitudes.`,
      { titulo: 'Desactivar cliente', textoConfirmar: 'Desactivar' }
    );
    if (!ok) return;
    desactivarMut.mutate(c.id);
  }

  function abrirNuevo() {
    setEditando(null);
    reset({});
    setCtaCobrar('');
    setShowModal(true);
  }

  function abrirEditar(c) {
    setEditando(c);
    reset(c);
    setCtaCobrar(c.cuenta_cobrar_codigo || '');
    setShowModal(true);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
        <button onClick={abrirNuevo} className="btn-primary">
          <Plus size={16} /> Nuevo cliente
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por razón social o RFC…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : data.length === 0 ? (
          <div className="text-center py-12">
            <Building2 size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">Sin clientes registrados</p>
            <button onClick={abrirNuevo} className="btn-primary mt-4">Agregar primero</button>
          </div>
        ) : filtrados.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Sin resultados con la búsqueda</p>
        ) : (
          <table className="table-auto w-full">
            <thead>
              <tr>
                <th>Razón social</th>
                <th>RFC</th>
                <th>Tipo</th>
                <th className="text-right">Límite crédito</th>
                <th className="text-center">Días crédito</th>
                <th className="text-center">Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((c) => (
                <tr key={c.id} className={!c.activo ? 'opacity-50' : ''}>
                  <td>
                    <p className="font-medium">{c.razon_social}</p>
                    {c.nombre_comercial && (
                      <p className="text-xs text-gray-400">{c.nombre_comercial}</p>
                    )}
                  </td>
                  <td className="font-mono text-xs">{c.rfc}</td>
                  <td><span className="badge-gray capitalize">{c.tipo_cliente}</span></td>
                  <td className="text-right">
                    {Number(c.limite_credito).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
                  </td>
                  <td className="text-center">{c.dias_credito}</td>
                  <td className="text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => abrirEditar(c)} className="text-xs text-brand-500 hover:underline">
                        Editar
                      </button>
                      {c.activo ? (
                        <button onClick={() => desactivar(c)} className="text-xs text-red-400 hover:underline">
                          Desactivar
                        </button>
                      ) : (
                        <button onClick={() => reactivarMut.mutate(c.id)} className="text-xs text-green-600 hover:underline">
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
        {!isLoading && (
          <Pagination page={page} totalPages={totalPages} total={total} from={from} to={to} onChange={setPage} />
        )}
      </div>

      {showModal && (
        <Modal
          title={editando ? 'Editar cliente' : 'Nuevo cliente'}
          onClose={() => { setShowModal(false); setEditando(null); reset(); }}
        >
          <form onSubmit={handleSubmit((d) => guardarMut.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Razón social *</label>
                <input className="input" {...register('razon_social', { required: 'Requerido' })} />
                {errors.razon_social && <p className="text-xs text-red-500 mt-1">{errors.razon_social.message}</p>}
              </div>
              <div>
                <label className="label">RFC *</label>
                <input className="input uppercase" {...register('rfc', { required: 'Requerido' })} />
                {errors.rfc && <p className="text-xs text-red-500 mt-1">{errors.rfc.message}</p>}
              </div>
              <div>
                <label className="label">Tipo de cliente</label>
                <select className="input" {...register('tipo_cliente')}>
                  {TIPOS.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Nombre comercial</label>
                <input className="input" {...register('nombre_comercial')} />
              </div>
              <div>
                <label className="label">Régimen fiscal (clave SAT)</label>
                <input className="input" placeholder="601" {...register('regimen_fiscal')} />
              </div>
              <div>
                <label className="label">Uso de CFDI</label>
                <input className="input uppercase" placeholder="G03" {...register('uso_cfdi')} />
              </div>
              <div>
                <label className="label">Código postal (dom. fiscal)</label>
                <input className="input" maxLength={5} placeholder="06700" {...register('codigo_postal')} />
              </div>
              <div>
                <label className="label">Email (envío CFDI)</label>
                <input type="email" className="input" {...register('email')} />
              </div>
              <div>
                <label className="label">Límite de crédito (MXN)</label>
                <input type="number" className="input" min="0" step="0.01" {...register('limite_credito')} />
              </div>
              <div>
                <label className="label">Días de crédito</label>
                <input type="number" className="input" min="0" {...register('dias_credito')} />
              </div>
            </div>
            <div>
              <label className="label">Dirección fiscal</label>
              <textarea className="input min-h-[60px]" {...register('direccion_fiscal')} />
            </div>

            <div className="border-t border-gray-100 pt-4">
              <label className="label">Cuenta por cobrar (contabilidad)</label>
              <CuentaContableSelect
                value={ctaCobrar}
                onChange={setCtaCobrar}
                rubro="Activo"
                placeholder="Sin asignar (def. 105 Clientes)"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={guardarMut.isPending} className="btn-primary">
                {guardarMut.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
                {editando ? 'Guardar cambios' : 'Crear cliente'}
              </button>
              <button type="button" onClick={() => { setShowModal(false); reset(); }} className="btn-secondary">
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {dialogoConfirm}
    </div>
  );
}
