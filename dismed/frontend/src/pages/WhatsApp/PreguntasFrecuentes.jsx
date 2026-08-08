import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { FileQuestion, Plus, Pencil, Trash2, MessageCircleMore } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * Preguntas frecuentes del chatbot de WhatsApp (permiso whatsapp-faqs, solo
 * admin): respuestas fijas de negocio que el chatbot contesta automáticamente
 * (ver whatsapp.chatbot.service.js) cuando un cliente escribe algo que
 * coincide con una de estas preguntas. No requiere tocar código para agregar,
 * editar o desactivar una pregunta.
 */
export default function PreguntasFrecuentes() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null); // null | {} (nueva) | faq (editar)
  const { confirmar, dialogoConfirm } = useConfirm();

  const { data = [], isLoading } = useQuery({
    queryKey: ['wa-faqs'],
    queryFn: () => api.get('/whatsapp/faqs').then((r) => r.data),
  });

  const eliminar = useMutation({
    mutationFn: (id) => api.delete(`/whatsapp/faqs/${id}`),
    onSuccess: () => { toast.success('Pregunta eliminada'); qc.invalidateQueries({ queryKey: ['wa-faqs'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al eliminar'),
  });

  async function pedirEliminar(faq) {
    if (await confirmar(`¿Eliminar la pregunta "${faq.pregunta}"? El chatbot dejará de contestarla.`, { titulo: 'Eliminar pregunta' })) {
      eliminar.mutate(faq.id);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <FileQuestion size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Preguntas frecuentes</h1>
        </div>
        <button className="btn-primary" onClick={() => setModal({})}>
          <Plus size={16} /> Nueva pregunta
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Respuestas automáticas que el chatbot de WhatsApp contesta cuando un cliente pregunta algo que coincide.
        Solo las preguntas activas se toman en cuenta.
      </p>

      <SaludoBienvenida />

      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th className="w-14 text-center">Orden</th>
              <th>Cuándo aplica</th>
              <th>Respuesta</th>
              <th className="text-center">Activa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((f) => (
              <tr key={f.id}>
                <td className="text-center text-gray-400">{f.orden}</td>
                <td className="max-w-xs">{f.pregunta}</td>
                <td className="max-w-md text-sm text-gray-600 whitespace-pre-wrap">{f.respuesta}</td>
                <td className="text-center">
                  {f.activo ? <span className="badge-green">Sí</span> : <span className="badge-gray">No</span>}
                </td>
                <td>
                  <div className="flex items-center gap-1">
                    <button className="p-1.5 text-gray-400 hover:text-brand-500 rounded-lg" title="Editar" onClick={() => setModal(f)}>
                      <Pencil size={15} />
                    </button>
                    <button className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg" title="Eliminar" onClick={() => pedirEliminar(f)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && !data.length && (
              <tr><td colSpan={5} className="text-center text-gray-400 py-8">Sin preguntas frecuentes configuradas.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <ModalFaq
          faq={modal.id ? modal : null}
          siguienteOrden={data.length + 1}
          onClose={() => setModal(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['wa-faqs'] }); setModal(null); }}
        />
      )}

      {dialogoConfirm}
    </div>
  );
}

/**
 * Saludo que se envía en el primer mensaje de una conversación nueva (o el
 * primero después de varias horas sin actividad — ver NUEVA_SESION_HORAS en
 * whatsapp.service.js), combinado con lo que conteste el chatbot si aplica.
 * Dejarlo vacío lo desactiva sin afectar las preguntas frecuentes de abajo.
 */
function SaludoBienvenida() {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['wa-saludo'],
    queryFn: () => api.get('/whatsapp/config/saludo').then((r) => r.data),
  });

  useEffect(() => {
    if (data) setTexto(data.saludo_bienvenida || '');
  }, [data]);

  const guardar = useMutation({
    mutationFn: (saludo_bienvenida) => api.put('/whatsapp/config/saludo', { saludo_bienvenida }),
    onSuccess: () => { toast.success('Saludo actualizado'); qc.invalidateQueries({ queryKey: ['wa-saludo'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  const sinCambios = !isLoading && texto === (data?.saludo_bienvenida || '');

  return (
    <div className="card mb-4">
      <div className="flex items-center gap-2 mb-2">
        <MessageCircleMore size={18} className="text-brand-500" />
        <h2 className="font-semibold text-gray-900">Saludo de bienvenida</h2>
      </div>
      <p className="text-sm text-gray-400 mb-2">
        Se envía automáticamente en el primer mensaje de una conversación nueva (cualquier forma en que
        el cliente la abra: "hola", "buenas tardes", "disculpe"...), junto con la respuesta del chatbot si
        también reconoce una pregunta. Déjalo vacío para desactivarlo.
      </p>
      <textarea
        className="input"
        rows={3}
        placeholder='¡Hola! Gracias por contactarnos. ¿En qué podemos ayudarte?'
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="flex justify-end mt-2">
        <button
          className="btn-primary"
          disabled={sinCambios || guardar.isPending}
          onClick={() => guardar.mutate(texto)}
        >
          Guardar
        </button>
      </div>
    </div>
  );
}

function ModalFaq({ faq, siguienteOrden, onClose, onSaved }) {
  const editar = !!faq;
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      pregunta: faq?.pregunta || '',
      respuesta: faq?.respuesta || '',
      activo: faq ? !!faq.activo : true,
      orden: faq?.orden ?? siguienteOrden,
    },
  });

  const guardar = useMutation({
    mutationFn: (form) => (editar
      ? api.put(`/whatsapp/faqs/${faq.id}`, form)
      : api.post('/whatsapp/faqs', form)),
    onSuccess: () => { toast.success(editar ? 'Pregunta actualizada' : 'Pregunta creada'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  return (
    <Modal title={editar ? 'Editar pregunta' : 'Nueva pregunta'} onClose={onClose} size="md">
      <form className="space-y-3" onSubmit={handleSubmit((f) => guardar.mutate(f))}>
        <div>
          <label className="label">¿Cuándo aplica? (describe la pregunta del cliente)</label>
          <input className="input" autoFocus placeholder="Pregunta si tienen servicio a domicilio, costo del envío…"
            {...register('pregunta', { required: 'Requerido' })} />
          {errors.pregunta && <p className="text-xs text-red-500 mt-1">{errors.pregunta.message}</p>}
          <p className="text-xs text-gray-400 mt-1">
            Esto lo usa la IA para reconocer cuándo un mensaje del cliente corresponde a esta pregunta — no es lo que se le contesta.
          </p>
        </div>
        <div>
          <label className="label">Respuesta que enviará el chatbot</label>
          <textarea className="input" rows={4} placeholder="Sí, tenemos servicio a domicilio…"
            {...register('respuesta', { required: 'Requerido' })} />
          {errors.respuesta && <p className="text-xs text-red-500 mt-1">{errors.respuesta.message}</p>}
        </div>
        <div className="flex items-center gap-4">
          <div className="w-24">
            <label className="label">Orden</label>
            <input type="number" min={0} className="input" {...register('orden', { valueAsNumber: true })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
            <input type="checkbox" {...register('activo')} />
            Activa (el chatbot la contesta)
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={guardar.isPending}>
            {editar ? 'Guardar cambios' : 'Crear pregunta'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
