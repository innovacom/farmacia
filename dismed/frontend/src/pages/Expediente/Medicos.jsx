import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Loader2, Stethoscope, Search } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';

export default function Medicos() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [q, setQ] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['medicos-admin'],
    queryFn: () => api.get('/pos/medicos', { params: { admin: '1' } }).then((r) => r.data),
  });

  const filtrados = data.filter((m) =>
    `${m.nombre} ${m.cedula_profesional} ${m.especialidad || ''}`.toLowerCase().includes(q.trim().toLowerCase())
  );

  const { register, handleSubmit, reset, formState: { errors } } = useForm();

  const guardarMut = useMutation({
    mutationFn: (d) => (editando ? api.put(`/pos/medicos/${editando.id}`, d) : api.post('/pos/medicos', d)),
    onSuccess: () => {
      toast.success(editando ? 'Médico actualizado' : 'Médico creado');
      qc.invalidateQueries(['medicos-admin']);
      qc.invalidateQueries(['medicos']);
      setShowModal(false);
      setEditando(null);
      reset();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const toggleActivoMut = useMutation({
    mutationFn: ({ id, activo }) => api.put(`/pos/medicos/${id}`, { activo }),
    onSuccess: () => {
      toast.success('Actualizado');
      qc.invalidateQueries(['medicos-admin']);
      qc.invalidateQueries(['medicos']);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  function abrirNuevo() { setEditando(null); reset({}); setShowModal(true); }
  function abrirEditar(m) { setEditando(m); reset(m); setShowModal(true); }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Médicos</h1>
          <p className="text-sm text-gray-400">Catálogo de médicos del consultorio (también usado por el POS para recetas)</p>
        </div>
        <button onClick={abrirNuevo} className="btn-primary">
          <Plus size={16} /> Nuevo médico
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por nombre o cédula…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : data.length === 0 ? (
          <div className="text-center py-12">
            <Stethoscope size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">Sin médicos registrados</p>
            <button onClick={abrirNuevo} className="btn-primary mt-4">Agregar primero</button>
          </div>
        ) : (
          <table className="table-auto w-full">
            <thead>
              <tr>
                <th>Nombre</th><th>Cédula profesional</th><th>S.S.A.</th><th>Especialidad</th><th>Teléfono</th>
                <th className="text-center">Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((m) => (
                <tr key={m.id} className={!m.activo ? 'opacity-50' : ''}>
                  <td className="font-medium">{m.nombre}</td>
                  <td className="font-mono text-xs">{m.cedula_profesional}</td>
                  <td className="font-mono text-xs">{m.registro_ssa || '—'}</td>
                  <td>{m.especialidad || '—'}</td>
                  <td>{m.telefono || '—'}</td>
                  <td className="text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {m.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => abrirEditar(m)} className="text-xs text-brand-500 hover:underline">Editar</button>
                      {m.activo ? (
                        <button onClick={() => toggleActivoMut.mutate({ id: m.id, activo: 0 })} className="text-xs text-red-400 hover:underline">
                          Desactivar
                        </button>
                      ) : (
                        <button onClick={() => toggleActivoMut.mutate({ id: m.id, activo: 1 })} className="text-xs text-green-600 hover:underline">
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
      </div>

      {showModal && (
        <Modal title={editando ? 'Editar médico' : 'Nuevo médico'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit((d) => guardarMut.mutate(d))} className="space-y-4">
            <div>
              <label className="label">Nombre *</label>
              <input className="input" {...register('nombre', { required: 'Requerido' })} />
              {errors.nombre && <p className="text-xs text-red-500 mt-1">{errors.nombre.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Cédula profesional *</label>
                <input className="input" {...register('cedula_profesional', { required: 'Requerido' })} />
                {errors.cedula_profesional && <p className="text-xs text-red-500 mt-1">{errors.cedula_profesional.message}</p>}
              </div>
              <div>
                <label className="label">Registro S.S.A.</label>
                <input className="input" {...register('registro_ssa')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Especialidad</label>
                <input className="input" {...register('especialidad')} />
              </div>
              <div>
                <label className="label">Teléfono (se imprime como CEL. en la receta)</label>
                <input className="input" {...register('telefono')} />
              </div>
            </div>
            <div>
              <label className="label">Institución (emisora de la cédula)</label>
              <input className="input" {...register('institucion')} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={guardarMut.isPending} className="btn-primary">
                {guardarMut.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
                {editando ? 'Guardar cambios' : 'Crear médico'}
              </button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
