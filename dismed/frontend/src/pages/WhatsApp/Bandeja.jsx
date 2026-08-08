import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send, Search, ShieldOff } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

function fmtHora(fechaIso) {
  const d = new Date(fechaIso);
  return d.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const TIPO_LABEL = {
  recordatorio_cita: 'Recordatorio de cita',
  respuesta_automatica: 'Respuesta automática',
  plantilla_masiva: 'Envío masivo',
  texto_libre: 'Mensaje',
  entrante: 'Mensaje',
};

/**
 * Bandeja general de WhatsApp (permiso whatsapp-bandeja): sustituye a tener
 * WhatsApp Web abierto aparte para escribirle a un paciente/cliente que no
 * tiene una cita asociada. Reusa el mismo historial que alimenta el flujo
 * automático de citas (whatsapp.service.js), así que ahí también aparecen
 * los recordatorios y las respuestas del bot.
 */
export default function Bandeja() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [contactoId, setContactoId] = useState(null);
  const [texto, setTexto] = useState('');
  const bottomRef = useRef(null);

  const { data: conversaciones = [], isLoading } = useQuery({
    queryKey: ['wa-conversaciones', q],
    queryFn: () => api.get('/whatsapp/conversaciones', { params: { q: q || undefined } }).then((r) => r.data),
    refetchInterval: 15000,
  });

  const contactoActivo = conversaciones.find((c) => c.contacto_id === contactoId);

  const { data: mensajes = [] } = useQuery({
    queryKey: ['wa-mensajes', contactoId],
    queryFn: () => api.get(`/whatsapp/conversaciones/${contactoId}/mensajes`).then((r) => r.data),
    enabled: !!contactoId,
    refetchInterval: 8000,
  });

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [mensajes.length, contactoId]);

  const marcarLeido = useMutation({
    mutationFn: (id) => api.post(`/whatsapp/conversaciones/${id}/leido`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-conversaciones'] }),
  });

  function abrirConversacion(c) {
    setContactoId(c.contacto_id);
    if (c.no_leidos > 0) marcarLeido.mutate(c.contacto_id);
  }

  const enviar = useMutation({
    mutationFn: () => api.post(`/whatsapp/conversaciones/${contactoId}/mensajes`, { texto }),
    onSuccess: () => {
      setTexto('');
      qc.invalidateQueries({ queryKey: ['wa-mensajes', contactoId] });
      qc.invalidateQueries({ queryKey: ['wa-conversaciones'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo enviar (¿pasaron más de 24h desde su último mensaje?)'),
  });

  function onSubmit(e) {
    e.preventDefault();
    if (!texto.trim() || enviar.isPending) return;
    enviar.mutate();
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <MessageCircle size={22} className="text-brand-500" />
        <h1 className="text-2xl font-bold text-gray-900">Bandeja de WhatsApp</h1>
      </div>

      <div className="card p-0 overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: 420 }}>
        <div className="flex h-full">
          {/* Lista de conversaciones */}
          <div className="w-72 shrink-0 border-r border-gray-100 flex flex-col">
            <div className="p-3 border-b border-gray-100">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                <input
                  className="input pl-8 py-1.5 text-sm"
                  placeholder="Buscar contacto..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoading && <p className="text-xs text-gray-400 p-3">Cargando…</p>}
              {!isLoading && !conversaciones.length && (
                <p className="text-xs text-gray-400 p-3">Sin conversaciones todavía.</p>
              )}
              {conversaciones.map((c) => (
                <button
                  key={c.contacto_id}
                  onClick={() => abrirConversacion(c)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors
                    ${contactoId === c.contacto_id ? 'bg-brand-50' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm truncate ${c.no_leidos ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                      {c.nombre || c.telefono_normalizado}
                    </p>
                    {c.no_leidos > 0 && (
                      <span className="bg-brand-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 shrink-0">
                        {c.no_leidos}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {c.ultimo_direccion === 'saliente' ? 'Tú: ' : ''}{c.ultimo_mensaje || 'Sin mensajes'}
                  </p>
                  {c.ultimo_en && <p className="text-[10px] text-gray-300 mt-0.5">{fmtHora(c.ultimo_en)}</p>}
                </button>
              ))}
            </div>
          </div>

          {/* Hilo de mensajes */}
          <div className="flex-1 flex flex-col min-w-0">
            {!contactoId ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                Elige una conversación para ver el historial.
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
                  <div>
                    <p className="font-semibold text-gray-900">{contactoActivo?.nombre || contactoActivo?.telefono_normalizado}</p>
                    <p className="text-xs text-gray-400">{contactoActivo?.telefono_normalizado}</p>
                  </div>
                  {contactoActivo?.acepta_promociones === 0 && (
                    <span className="badge-gray flex items-center gap-1"><ShieldOff size={11} /> No promociones</span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50/50">
                  {mensajes.map((m) => (
                    <div key={m.id} className={`flex ${m.direccion === 'saliente' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm
                        ${m.direccion === 'saliente' ? 'bg-brand-500 text-white rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'}`}>
                        {m.tipo !== 'texto_libre' && m.tipo !== 'entrante' && (
                          <p className={`text-[10px] mb-0.5 font-semibold uppercase tracking-wide ${m.direccion === 'saliente' ? 'text-brand-100' : 'text-gray-400'}`}>
                            {TIPO_LABEL[m.tipo] || m.tipo}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.contenido}</p>
                        <p className={`text-[10px] mt-1 text-right ${m.direccion === 'saliente' ? 'text-brand-100' : 'text-gray-400'}`}>
                          {fmtHora(m.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
                <form onSubmit={onSubmit} className="p-3 border-t border-gray-100 flex items-center gap-2 shrink-0">
                  <input
                    className="input flex-1"
                    placeholder="Escribe un mensaje..."
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                  />
                  <button type="submit" className="btn-primary" disabled={!texto.trim() || enviar.isPending}>
                    <Send size={15} />
                  </button>
                </form>
                <p className="text-[11px] text-gray-400 px-3 pb-2">
                  Solo se puede escribir texto libre dentro de las 24h desde su último mensaje; fuera de esa ventana usa Envío masivo con una plantilla aprobada.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
