import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Loader2, Stethoscope, Search, Clock, X } from 'lucide-react';
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

            {editando && (
              <div className="border-t border-gray-100 pt-3">
                <HorarioMedico medicoId={editando.id} />
              </div>
            )}

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

const DIAS_SEMANA = [
  { v: 1, label: 'Lunes' }, { v: 2, label: 'Martes' }, { v: 3, label: 'Miércoles' },
  { v: 4, label: 'Jueves' }, { v: 5, label: 'Viernes' }, { v: 6, label: 'Sábado' }, { v: 7, label: 'Domingo' },
];

// Turnos semanales que consulta el chatbot de WhatsApp para decir quién está
// en turno ahora mismo (whatsapp.chatbot.service.js) — no liga con pos_citas
// (las citas no distinguen médico, ver migrate_v37). Varios turnos por día
// son válidos (matutino + vespertino), por eso es una lista y no un rango fijo.
function HorarioMedico({ medicoId }) {
  const [turnos, setTurnos] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['medico-horarios', medicoId],
    queryFn: () => api.get(`/pos/medicos/${medicoId}/horarios`).then((r) => r.data),
  });

  useEffect(() => {
    if (data) setTurnos(data.map((t) => ({ dia_semana: t.dia_semana, hora_inicio: t.hora_inicio.slice(0, 5), hora_fin: t.hora_fin.slice(0, 5) })));
  }, [data]);

  const set = (idx, campo, valor) => setTurnos((ts) => ts.map((t, i) => (i === idx ? { ...t, [campo]: valor } : t)));
  const quitar = (idx) => setTurnos((ts) => ts.filter((_, i) => i !== idx));
  const agregar = () => setTurnos((ts) => [...(ts || []), { dia_semana: 1, hora_inicio: '09:00', hora_fin: '14:00' }]);

  const guardar = useMutation({
    mutationFn: () => api.put(`/pos/medicos/${medicoId}/horarios`, { turnos: turnos || [] }),
    onSuccess: () => toast.success('Turnos guardados'),
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar turnos'),
  });

  return (
    <div>
      <label className="label flex items-center gap-1.5">
        <Clock size={13} className="text-brand-500" /> Turnos (para el chatbot de WhatsApp)
      </label>
      <p className="text-xs text-gray-400 mb-2">
        El chatbot contesta "¿hay doctor?" según estos turnos. Puede haber más de uno por día (ej. matutino y vespertino).
      </p>
      {!turnos || isLoading ? (
        <p className="text-xs text-gray-400">Cargando…</p>
      ) : (
        <div className="space-y-1.5">
          {turnos.map((t, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <select className="input py-1 text-xs w-28" value={t.dia_semana}
                onChange={(e) => set(idx, 'dia_semana', Number(e.target.value))}>
                {DIAS_SEMANA.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
              </select>
              <input type="time" className="input py-1 text-xs w-24" value={t.hora_inicio}
                onChange={(e) => set(idx, 'hora_inicio', e.target.value)} />
              <span className="text-gray-400">a</span>
              <input type="time" className="input py-1 text-xs w-24" value={t.hora_fin}
                onChange={(e) => set(idx, 'hora_fin', e.target.value)} />
              <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => quitar(idx)}>
                <X size={14} />
              </button>
            </div>
          ))}
          {!turnos.length && <p className="text-xs text-gray-400">Sin turnos cargados.</p>}
          <div className="flex justify-between items-center pt-1">
            <button type="button" className="text-xs text-brand-500 hover:underline" onClick={agregar}>+ Agregar turno</button>
            <button type="button" className="btn-secondary btn-sm" disabled={guardar.isPending} onClick={() => guardar.mutate()}>
              {guardar.isPending ? 'Guardando…' : 'Guardar turnos'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
