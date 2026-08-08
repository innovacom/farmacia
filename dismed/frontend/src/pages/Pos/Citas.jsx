import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Plus, Pencil, Ban, CreditCard, ChevronLeft, ChevronRight, Phone, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { linkWhatsApp, mensajeRecordatorioCita } from '../../utils/whatsapp';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const SLOT_INICIO = 10 * 60; // 10:00
const SLOT_FIN = 19 * 60 + 30; // último horario que inicia (termina 20:00)
const SLOT_PASO = 30;

function hoyISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function sumarDias(fechaISO, delta) {
  const d = new Date(`${fechaISO}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}
function diaSemana(fechaISO) {
  return new Date(`${fechaISO}T12:00:00`).getDay();
}
function fmtFecha(fechaISO) {
  const [y, m, d] = fechaISO.split('-');
  return `${DIAS[diaSemana(fechaISO)]} ${d}/${m}/${y}`;
}
function minAHora(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function slotsDelDia() {
  const out = [];
  for (let m = SLOT_INICIO; m <= SLOT_FIN; m += SLOT_PASO) out.push(minAHora(m));
  return out;
}
const money = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const ESTATUS_BADGE = {
  agendada: 'badge-yellow',
  atendida: 'badge-green',
  cancelada: 'badge-gray',
};
const ESTATUS_LABEL = { agendada: 'Agendada', atendida: 'Pagada', cancelada: 'Cancelada' };

/**
 * Agenda de citas médicas del mostrador (permiso pos-citas). No importa qué
 * médico esté de guardia: solo se aparta horario + nombre del paciente.
 * Cuando el paciente se presenta a pagar (a veces antes de la cita), "Cobrar"
 * abre la venta normal de mostrador; al completarse esa venta la cita queda
 * ligada y marcada como pagada.
 */
export default function Citas() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { confirmar, dialogoConfirm } = useConfirm();

  const [sucursalId, setSucursalId] = useState(() => localStorage.getItem('pos-citas-sucursal') || '');
  const [fecha, setFecha] = useState(hoyISO());
  const [modalCita, setModalCita] = useState(null); // null | {} (nueva) | cita (editar)

  useEffect(() => { if (sucursalId) localStorage.setItem('pos-citas-sucursal', sucursalId); }, [sucursalId]);

  const { data: sucursales = [] } = useQuery({
    queryKey: ['pos-sucursales'],
    queryFn: () => api.get('/pos/sucursales').then((r) => r.data),
  });
  useEffect(() => {
    if (!sucursalId && sucursales.length) setSucursalId(String(sucursales[0].id));
  }, [sucursales, sucursalId]);

  const { data: citasDia = [], isLoading } = useQuery({
    queryKey: ['pos-citas', sucursalId, fecha],
    queryFn: () => api.get('/pos/citas', { params: { sucursal_id: sucursalId, desde: fecha, hasta: fecha } }).then((r) => r.data),
    enabled: !!sucursalId,
  });

  const cancelar = useMutation({
    mutationFn: (id) => api.post(`/pos/citas/${id}/cancelar`, {}),
    onSuccess: () => { toast.success('Cita cancelada'); qc.invalidateQueries({ queryKey: ['pos-citas'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al cancelar'),
  });

  const confirmarCita = useMutation({
    mutationFn: (id) => api.post(`/pos/citas/${id}/confirmar`, {}),
    onSuccess: () => { toast.success('Cita confirmada'); qc.invalidateQueries({ queryKey: ['pos-citas'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al confirmar'),
  });

  // Si la API de WhatsApp ya está configurada (ver Configuración), el
  // recordatorio se manda automático y la respuesta del paciente llega sola
  // por webhook; si no, se usa el enlace manual wa.me de respaldo.
  const { data: waEstado } = useQuery({
    queryKey: ['whatsapp-estado'],
    queryFn: () => api.get('/whatsapp/estado').then((r) => r.data),
  });
  const enviarRecordatorioApi = useMutation({
    mutationFn: (id) => api.post(`/pos/citas/${id}/recordatorio-whatsapp`, {}),
    onSuccess: () => toast.success('Recordatorio enviado por WhatsApp'),
    onError: (e) => toast.error(e.response?.data?.error || 'Error al enviar el recordatorio'),
  });

  async function onCancelar(cita) {
    const ok = await confirmar(
      `¿Cancelar la cita de ${cita.paciente_nombre} a las ${cita.hora_inicio.slice(0, 5)}?`,
      { titulo: 'Cancelar cita' }
    );
    if (ok) cancelar.mutate(cita.id);
  }

  const domingo = diaSemana(fecha) === 0;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-6">
        <CalendarClock size={22} className="text-brand-500" />
        <h1 className="text-2xl font-bold text-gray-900">Citas médicas</h1>
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {sucursales.length > 1 && (
            <select className="input w-auto" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1">
            <button className="p-2 text-gray-400 hover:text-brand-500 rounded-lg" onClick={() => setFecha((f) => sumarDias(f, -1))}>
              <ChevronLeft size={18} />
            </button>
            <input type="date" className="input w-auto" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <button className="p-2 text-gray-400 hover:text-brand-500 rounded-lg" onClick={() => setFecha((f) => sumarDias(f, 1))}>
              <ChevronRight size={18} />
            </button>
            <button className="btn-secondary btn-sm" onClick={() => setFecha(hoyISO())}>Hoy</button>
          </div>
          <span className="text-sm text-gray-500 capitalize">{fmtFecha(fecha)}</span>
          <button
            className="btn-primary ml-auto"
            disabled={!sucursalId || domingo}
            onClick={() => setModalCita({})}
          >
            <Plus size={16} /> Nueva cita
          </button>
        </div>
        {domingo && (
          <p className="text-xs text-amber-600 mt-2">
            No hay servicio de citas los domingos (horario: lunes a sábado, 10:00 a 20:00).
          </p>
        )}
      </div>

      {isLoading ? (
        <p className="text-gray-400">Cargando…</p>
      ) : !citasDia.length ? (
        <div className="card text-center text-gray-500 py-10">
          Sin citas agendadas para este día.
        </div>
      ) : (
        <div className="space-y-2">
          {citasDia.map((cita) => (
            <div key={cita.id} className="card flex items-start gap-4">
              <div className="text-center shrink-0 w-16">
                <p className="text-lg font-bold text-gray-900">{cita.hora_inicio.slice(0, 5)}</p>
              </div>
              <div className="flex-1 min-w-0 border-l border-gray-100 pl-4">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900">{cita.paciente_nombre}</p>
                  <span className={ESTATUS_BADGE[cita.estatus]}>{ESTATUS_LABEL[cita.estatus]}</span>
                  {cita.estatus === 'agendada' && (
                    cita.confirmada
                      ? <span className="badge-green">Confirmada</span>
                      : <span className="badge-yellow">Sin confirmar</span>
                  )}
                </div>
                {cita.paciente_telefono && (
                  <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                    <Phone size={12} /> {cita.paciente_telefono}
                  </p>
                )}
                {cita.servicio_descripcion && (
                  <p className="text-sm text-gray-600 mt-0.5">
                    {cita.servicio_descripcion} · <span className="font-medium">{money(cita.servicio_precio)}</span>
                  </p>
                )}
                {cita.notas && <p className="text-sm text-gray-400 mt-0.5">{cita.notas}</p>}
                {!!cita.reprogramar_solicitado && (
                  <p className="text-xs text-amber-600 mt-1 font-medium">
                    El paciente pidió reprogramar por WhatsApp — contactarlo para elegir nuevo horario.
                  </p>
                )}
                {cita.estatus === 'atendida' && (
                  <p className="text-xs text-green-700 mt-1">
                    Cobrada — venta {cita.venta_folio} · {money(cita.venta_total)}
                  </p>
                )}
                {cita.estatus === 'cancelada' && cita.motivo_cancelacion && (
                  <p className="text-xs text-gray-400 mt-1">Motivo: {cita.motivo_cancelacion}</p>
                )}
              </div>
              {cita.estatus === 'agendada' && (
                <div className="flex items-center gap-1 shrink-0">
                  {!cita.confirmada && cita.paciente_telefono && (
                    waEstado?.configurado ? (
                      <button
                        className="btn-secondary btn-sm"
                        title="Enviar recordatorio por WhatsApp (automático)"
                        disabled={enviarRecordatorioApi.isPending}
                        onClick={() => enviarRecordatorioApi.mutate(cita.id)}
                      >
                        WhatsApp
                      </button>
                    ) : (
                      <a
                        className="btn-secondary btn-sm"
                        title="Enviar recordatorio por WhatsApp (manual)"
                        href={linkWhatsApp(cita.paciente_telefono, mensajeRecordatorioCita(cita))}
                        target="_blank" rel="noreferrer"
                      >
                        WhatsApp
                      </a>
                    )
                  )}
                  {!cita.confirmada && (
                    <button
                      className="p-1.5 text-gray-400 hover:text-green-600 rounded-lg"
                      title="Marcar como confirmada"
                      onClick={() => confirmarCita.mutate(cita.id)}
                    >
                      <CheckCircle2 size={15} />
                    </button>
                  )}
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => navigate(`/pos?cita_id=${cita.id}`)}
                  >
                    <CreditCard size={14} /> Cobrar
                  </button>
                  <button
                    className="p-1.5 text-gray-400 hover:text-brand-500 rounded-lg"
                    title="Editar"
                    onClick={() => setModalCita(cita)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg"
                    title="Cancelar"
                    onClick={() => onCancelar(cita)}
                  >
                    <Ban size={15} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalCita !== null && (
        <ModalCita
          sucursalId={sucursalId}
          fechaInicial={fecha}
          cita={modalCita.id ? modalCita : null}
          onClose={() => setModalCita(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['pos-citas'] }); setModalCita(null); }}
        />
      )}
      {dialogoConfirm}
    </div>
  );
}

function ModalCita({ sucursalId, fechaInicial, cita, onClose, onSaved }) {
  const editar = !!cita;
  const [form, setForm] = useState({
    fecha: editar ? String(cita.fecha).slice(0, 10) : fechaInicial,
    hora_inicio: editar ? cita.hora_inicio.slice(0, 5) : '',
    producto_id: cita?.producto_id || '',
    paciente_nombre: cita?.paciente_nombre || '',
    paciente_telefono: cita?.paciente_telefono || '',
    notas: cita?.notas || '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const domingo = diaSemana(form.fecha) === 0;

  // Servicios agendables: catálogo de productos cuya familia es "médico"
  // (así se ve el costo desde la agenda, no solo hasta que se cobra).
  const { data: servicios = [] } = useQuery({
    queryKey: ['pos-citas-servicios'],
    queryFn: () => api.get('/pos/citas/servicios').then((r) => r.data),
  });
  const servicioElegido = servicios.find((s) => String(s.id) === String(form.producto_id));

  const { data: citasDelDia = [] } = useQuery({
    queryKey: ['pos-citas', sucursalId, form.fecha],
    queryFn: () => api.get('/pos/citas', { params: { sucursal_id: sucursalId, desde: form.fecha, hasta: form.fecha } }).then((r) => r.data),
    enabled: !!sucursalId && !!form.fecha,
  });
  const ocupadas = new Set(
    citasDelDia
      .filter((c) => c.estatus !== 'cancelada' && (!editar || c.id !== cita.id))
      .map((c) => c.hora_inicio.slice(0, 5))
  );

  const guardar = useMutation({
    mutationFn: () => (editar
      ? api.put(`/pos/citas/${cita.id}`, form)
      : api.post('/pos/citas', { ...form, sucursal_id: sucursalId })),
    onSuccess: () => { toast.success(editar ? 'Cita actualizada' : 'Cita agendada'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  return (
    <Modal title={editar ? 'Editar cita' : 'Nueva cita'} onClose={onClose} size="sm">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Fecha</label>
            <input type="date" className="input" value={form.fecha}
              onChange={(e) => set('fecha', e.target.value)} />
          </div>
          <div>
            <label className="label">Hora</label>
            <select className="input" value={form.hora_inicio} onChange={(e) => set('hora_inicio', e.target.value)}>
              <option value="">— Elegir —</option>
              {slotsDelDia().map((s) => (
                <option key={s} value={s} disabled={ocupadas.has(s)}>
                  {s}{ocupadas.has(s) ? ' (ocupado)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        {domingo && <p className="text-xs text-red-500">No hay servicio de citas los domingos.</p>}
        <div>
          <label className="label">Servicio</label>
          <select className="input" value={form.producto_id} onChange={(e) => set('producto_id', e.target.value)}>
            <option value="">— Elegir servicio —</option>
            {servicios.map((s) => (
              <option key={s.id} value={s.id}>{s.descripcion} — {money(s.precio_lista)}</option>
            ))}
          </select>
          {!servicios.length && (
            <p className="text-xs text-amber-600 mt-1">
              No hay productos en la familia "médico" del catálogo. Da de alta al menos uno (Inventario → Catálogo de productos) para poder agendar.
            </p>
          )}
          {servicioElegido && (
            <p className="text-xs text-gray-500 mt-1">Costo: <span className="font-semibold text-gray-700">{money(servicioElegido.precio_lista)}</span></p>
          )}
        </div>
        <div>
          <label className="label">Nombre del paciente</label>
          <input className="input" value={form.paciente_nombre} autoFocus
            onChange={(e) => set('paciente_nombre', e.target.value)} placeholder="Nombre completo" />
        </div>
        <div>
          <label className="label">Teléfono (opcional)</label>
          <input className="input" value={form.paciente_telefono}
            onChange={(e) => set('paciente_telefono', e.target.value)} />
        </div>
        <div>
          <label className="label">Notas (opcional)</label>
          <textarea className="input" rows={2} value={form.notas}
            onChange={(e) => set('notas', e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn-primary"
            disabled={guardar.isPending || domingo || !form.hora_inicio || !form.producto_id || !form.paciente_nombre.trim()}
            onClick={() => guardar.mutate()}
          >
            {editar ? 'Guardar cambios' : 'Agendar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
