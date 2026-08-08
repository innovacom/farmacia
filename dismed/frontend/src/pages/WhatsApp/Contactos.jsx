import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Users, Plus, Pencil, Search } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';

/**
 * Libreta de contactos de WhatsApp (permiso whatsapp-bandeja): se alimenta
 * sola con cada mensaje entrante, y aquí se puede corregir el nombre,
 * etiquetar (para segmentar el envío masivo) y marcar quién no quiere
 * recibir promociones.
 */
export default function Contactos() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // null | {} (nuevo) | contacto (editar)

  const { data = [], isLoading } = useQuery({
    queryKey: ['wa-contactos', q],
    queryFn: () => api.get('/whatsapp/contactos', { params: { q: q || undefined } }).then((r) => r.data),
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Users size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Contactos de WhatsApp</h1>
        </div>
        <button className="btn-primary" onClick={() => setModal({})}>
          <Plus size={16} /> Nuevo contacto
        </button>
      </div>

      <div className="card mb-4">
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input className="input pl-8" placeholder="Buscar por nombre o teléfono..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Etiquetas</th>
              <th className="text-center">Promociones</th>
              <th>Último contacto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td>{c.nombre || <span className="text-gray-400">Sin nombre</span>}</td>
                <td className="font-mono text-xs">{c.telefono_normalizado}</td>
                <td>
                  {String(c.etiquetas || '').split(',').filter(Boolean).map((t) => (
                    <span key={t} className="badge-yellow mr-1">{t.trim()}</span>
                  ))}
                </td>
                <td className="text-center">
                  {c.acepta_promociones ? <span className="badge-green">Sí</span> : <span className="badge-gray">No</span>}
                </td>
                <td className="text-xs text-gray-500">{c.ultimo_contacto_en ? String(c.ultimo_contacto_en).slice(0, 16).replace('T', ' ') : '—'}</td>
                <td>
                  <button className="p-1.5 text-gray-400 hover:text-brand-500 rounded-lg" title="Editar" onClick={() => setModal(c)}>
                    <Pencil size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && !data.length && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-8">Sin contactos todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <ModalContacto
          contacto={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['wa-contactos'] }); setModal(null); }}
        />
      )}
    </div>
  );
}

function ModalContacto({ contacto, onClose, onSaved }) {
  const editar = !!contacto;
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      telefono: contacto?.telefono_normalizado || '',
      nombre: contacto?.nombre || '',
      etiquetas: contacto?.etiquetas || '',
      notas: contacto?.notas || '',
      acepta_promociones: contacto ? !!contacto.acepta_promociones : true,
    },
  });

  const guardar = useMutation({
    mutationFn: (form) => (editar
      ? api.put(`/whatsapp/contactos/${contacto.id}`, form)
      : api.post('/whatsapp/contactos', form)),
    onSuccess: () => { toast.success(editar ? 'Contacto actualizado' : 'Contacto creado'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  return (
    <Modal title={editar ? 'Editar contacto' : 'Nuevo contacto'} onClose={onClose} size="sm">
      <form className="space-y-3" onSubmit={handleSubmit((f) => guardar.mutate(f))}>
        {!editar && (
          <div>
            <label className="label">Teléfono (10 dígitos)</label>
            <input className="input" maxLength={10} placeholder="5512345678"
              {...register('telefono', { required: 'Requerido', pattern: { value: /^\d{10}$/, message: '10 dígitos, sin lada' } })} />
            {errors.telefono && <p className="text-xs text-red-500 mt-1">{errors.telefono.message}</p>}
          </div>
        )}
        <div>
          <label className="label">Nombre</label>
          <input className="input" autoFocus={editar} {...register('nombre')} />
        </div>
        <div>
          <label className="label">Etiquetas (separadas por coma)</label>
          <input className="input" placeholder="mayoreo, clinica-norte" {...register('etiquetas')} />
        </div>
        <div>
          <label className="label">Notas</label>
          <textarea className="input" rows={2} {...register('notas')} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" {...register('acepta_promociones')} />
          Acepta recibir mensajes promocionales (envío masivo)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={guardar.isPending}>
            {editar ? 'Guardar cambios' : 'Crear contacto'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
