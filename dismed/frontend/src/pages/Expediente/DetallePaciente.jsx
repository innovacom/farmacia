import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Loader2, Plus, Stethoscope, FileText, ClipboardList,
  ChevronDown, ChevronUp, Link2,
} from 'lucide-react';
import api from '../../services/api';
import { useTurnoActivo } from '../../hooks/useTurnoActivo';
import Modal from '../../components/ui/Modal';
import TurnoBar from './TurnoBar';

const TABS = [
  { key: 'datos', label: 'Datos generales', icon: ClipboardList },
  { key: 'antecedentes', label: 'Antecedentes', icon: FileText },
  { key: 'consultas', label: 'Consultas', icon: Stethoscope },
  { key: 'recetas', label: 'Recetas', icon: FileText },
];

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function DetallePaciente() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState('datos');
  const turnoState = useTurnoActivo();

  const { data: paciente, isLoading } = useQuery({
    queryKey: ['expediente-paciente', id],
    queryFn: () => api.get(`/expediente/pacientes/${id}`).then((r) => r.data),
  });

  if (isLoading) return <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>;
  if (!paciente) return <p className="text-sm text-gray-400 text-center py-10">Paciente no encontrado</p>;

  return (
    <div>
      <button onClick={() => navigate('/expediente')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={15} /> Volver a pacientes
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {paciente.nombre} {paciente.apellido_paterno} {paciente.apellido_materno}
          </h1>
          <p className="text-sm text-gray-400">Médico de cabecera: {paciente.medico_nombre || '—'}</p>
        </div>
      </div>

      <TurnoBar turnoState={turnoState} />

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'datos' && <DatosGenerales paciente={paciente} qc={qc} />}
      {tab === 'antecedentes' && <Antecedentes paciente={paciente} qc={qc} />}
      {tab === 'consultas' && <Consultas pacienteId={id} turno={turnoState.turno} />}
      {tab === 'recetas' && <Recetas pacienteId={id} turno={turnoState.turno} />}
    </div>
  );
}

// ── Datos generales ──────────────────────────────────────────────────────────

function DatosGenerales({ paciente, qc }) {
  const [editando, setEditando] = useState(false);
  const { register, handleSubmit } = useForm({ defaultValues: paciente });

  const guardarMut = useMutation({
    mutationFn: (data) => api.put(`/expediente/pacientes/${paciente.id}`, data),
    onSuccess: () => {
      toast.success('Datos actualizados');
      qc.invalidateQueries(['expediente-paciente', String(paciente.id)]);
      setEditando(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  if (editando) {
    return (
      <form onSubmit={handleSubmit((d) => guardarMut.mutate(d))} className="card space-y-4 max-w-xl">
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">Nombre(s)</label><input className="input" {...register('nombre')} /></div>
          <div><label className="label">Apellido paterno</label><input className="input" {...register('apellido_paterno')} /></div>
          <div><label className="label">Apellido materno</label><input className="input" {...register('apellido_materno')} /></div>
          <div><label className="label">Teléfono</label><input className="input" {...register('telefono')} /></div>
          <div><label className="label">Email</label><input className="input" {...register('email')} /></div>
          <div><label className="label">Tipo de sangre</label><input className="input" {...register('tipo_sangre')} /></div>
        </div>
        <div><label className="label">Dirección</label><textarea className="input min-h-[50px]" {...register('direccion')} /></div>
        <div><label className="label">Alergias</label><textarea className="input min-h-[50px]" {...register('alergias')} /></div>
        <div className="flex gap-3">
          <button type="submit" disabled={guardarMut.isPending} className="btn-primary">
            {guardarMut.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Guardar cambios
          </button>
          <button type="button" onClick={() => setEditando(false)} className="btn-secondary">Cancelar</button>
        </div>
      </form>
    );
  }

  return (
    <div className="card max-w-xl space-y-3">
      <Campo label="Médico de cabecera" valor={paciente.medico_nombre} />
      <Campo label="Fecha de nacimiento" valor={paciente.fecha_nacimiento?.slice?.(0, 10)} />
      <Campo label="Sexo" valor={{ M: 'Masculino', F: 'Femenino', X: 'Otro / sin especificar' }[paciente.sexo]} />
      <Campo label="CURP" valor={paciente.curp} />
      <Campo label="Tipo de sangre" valor={paciente.tipo_sangre} />
      <Campo label="Teléfono" valor={paciente.telefono} />
      <Campo label="Email" valor={paciente.email} />
      <Campo label="Dirección" valor={paciente.direccion} />
      <Campo label="Alergias" valor={paciente.alergias} />
      <Campo label="Contacto de emergencia" valor={[paciente.contacto_emergencia_nombre, paciente.contacto_emergencia_telefono].filter(Boolean).join(' · ')} />
      <button onClick={() => setEditando(true)} className="text-xs text-brand-500 hover:underline">Editar datos</button>
    </div>
  );
}

function Campo({ label, valor }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm text-gray-800">{valor || '—'}</p>
    </div>
  );
}

// ── Antecedentes (NOM-004) ───────────────────────────────────────────────────

function Antecedentes({ paciente, qc }) {
  const { register, handleSubmit } = useForm({ defaultValues: paciente.antecedentes || {} });

  const guardarMut = useMutation({
    mutationFn: (data) => api.put(`/expediente/pacientes/${paciente.id}/antecedentes`, data),
    onSuccess: () => {
      toast.success('Antecedentes guardados');
      qc.invalidateQueries(['expediente-paciente', String(paciente.id)]);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  return (
    <form onSubmit={handleSubmit((d) => guardarMut.mutate(d))} className="card space-y-4 max-w-2xl">
      <p className="text-xs text-gray-400">Sección exigida por la NOM-004-SSA3-2012 del expediente clínico.</p>
      <div>
        <label className="label">Antecedentes heredofamiliares</label>
        <textarea className="input min-h-[70px]" {...register('antecedentes_heredofamiliares')} />
      </div>
      <div>
        <label className="label">Antecedentes personales no patológicos</label>
        <textarea className="input min-h-[70px]" {...register('antecedentes_personales_no_patologicos')} />
      </div>
      <div>
        <label className="label">Antecedentes personales patológicos</label>
        <textarea className="input min-h-[70px]" {...register('antecedentes_personales_patologicos')} />
      </div>
      <button type="submit" disabled={guardarMut.isPending} className="btn-primary">
        {guardarMut.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Guardar antecedentes
      </button>
    </form>
  );
}

// ── Consultas (notas de evolución, inmutables) ──────────────────────────────

function Consultas({ pacienteId, turno }) {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const { register, handleSubmit, reset } = useForm();

  const { data: consultas = [], isLoading } = useQuery({
    queryKey: ['expediente-consultas', pacienteId],
    queryFn: () => api.get(`/expediente/pacientes/${pacienteId}/consultas`).then((r) => r.data),
  });

  const crearMut = useMutation({
    mutationFn: (d) => {
      const { ta, fc, fr, temp, peso, talla, spo2, ...resto } = d;
      const signos_vitales = { ta, fc, fr, temp, peso, talla, spo2 };
      return api.post(`/expediente/pacientes/${pacienteId}/consultas`, { ...resto, signos_vitales, turno_id: turno?.id });
    },
    onSuccess: () => {
      toast.success('Consulta registrada');
      qc.invalidateQueries(['expediente-consultas', pacienteId]);
      setShowModal(false);
      reset();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => { reset({}); setShowModal(true); }}
          disabled={!turno}
          title={!turno ? 'Abre un turno para registrar consultas' : ''}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={16} /> Nueva consulta
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
      ) : consultas.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10 card">Sin consultas registradas</p>
      ) : (
        <div className="space-y-3">
          {consultas.map((c) => (
            <div key={c.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-800">{fmt(c.fecha_hora)}</p>
                <p className="text-xs text-gray-400">{c.medico_nombre}{c.medico_cedula ? ` · Cédula ${c.medico_cedula}` : ''}{c.sucursal_nombre ? ` · ${c.sucursal_nombre}` : ''}</p>
              </div>
              {c.motivo_consulta && <p className="text-sm text-gray-700 mb-1"><strong>Motivo:</strong> {c.motivo_consulta}</p>}
              {c.padecimiento_actual && <p className="text-sm text-gray-700 mb-1"><strong>Padecimiento actual:</strong> {c.padecimiento_actual}</p>}
              {c.exploracion_fisica && <p className="text-sm text-gray-700 mb-1"><strong>Exploración física:</strong> {c.exploracion_fisica}</p>}
              {c.signos_vitales && (
                <p className="text-xs text-gray-500 mb-1">
                  {Object.entries(typeof c.signos_vitales === 'string' ? JSON.parse(c.signos_vitales) : c.signos_vitales)
                    .filter(([, v]) => v)
                    .map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(' · ')}
                </p>
              )}
              {c.diagnostico && <p className="text-sm text-gray-700 mb-1"><strong>Diagnóstico:</strong> {c.diagnostico}</p>}
              {c.plan_tratamiento && <p className="text-sm text-gray-700 mb-1"><strong>Plan de tratamiento:</strong> {c.plan_tratamiento}</p>}
              {c.pronostico && <p className="text-sm text-gray-700"><strong>Pronóstico:</strong> {c.pronostico}</p>}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title="Nueva consulta" onClose={() => setShowModal(false)} size="lg">
          <form onSubmit={handleSubmit((d) => crearMut.mutate(d))} className="space-y-4">
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              Atiende: <strong>{turno?.medico_nombre}</strong> · {turno?.sucursal_nombre}
            </p>
            <div>
              <label className="label">Motivo de la consulta</label>
              <input className="input" {...register('motivo_consulta')} />
            </div>
            <div>
              <label className="label">Padecimiento actual</label>
              <textarea className="input min-h-[60px]" {...register('padecimiento_actual')} />
            </div>
            <div>
              <label className="label">Exploración física</label>
              <textarea className="input min-h-[60px]" {...register('exploracion_fisica')} />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div><label className="label">TA</label><input className="input" placeholder="120/80" {...register('ta')} /></div>
              <div><label className="label">FC</label><input className="input" placeholder="lpm" {...register('fc')} /></div>
              <div><label className="label">FR</label><input className="input" placeholder="rpm" {...register('fr')} /></div>
              <div><label className="label">Temp.</label><input className="input" placeholder="°C" {...register('temp')} /></div>
              <div><label className="label">Peso</label><input className="input" placeholder="kg" {...register('peso')} /></div>
              <div><label className="label">Talla</label><input className="input" placeholder="cm" {...register('talla')} /></div>
              <div><label className="label">SpO2</label><input className="input" placeholder="%" {...register('spo2')} /></div>
            </div>
            <div>
              <label className="label">Diagnóstico</label>
              <textarea className="input min-h-[50px]" {...register('diagnostico')} />
            </div>
            <div>
              <label className="label">Plan de tratamiento</label>
              <textarea className="input min-h-[50px]" {...register('plan_tratamiento')} />
            </div>
            <div>
              <label className="label">Pronóstico</label>
              <input className="input" {...register('pronostico')} />
            </div>
            <p className="text-xs text-gray-400">
              Esta nota queda inmutable una vez guardada (trazabilidad NOM-004); cualquier corrección se captura como una nueva consulta.
            </p>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={crearMut.isPending} className="btn-primary">
                {crearMut.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Guardar consulta
              </button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Recetas electrónicas ─────────────────────────────────────────────────────

const PARTIDA_VACIA = {
  producto_id: null, sku_interno: '', medicamento_nombre: '', presentacion: '',
  dosis: '', via_administracion: '', frecuencia: '', duracion: '', cantidad: 1, indicaciones: '',
};

function Recetas({ pacienteId, turno }) {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [partidas, setPartidas] = useState([{ ...PARTIDA_VACIA }]);
  const [buscandoIdx, setBuscandoIdx] = useState(null);
  const { register, handleSubmit, reset } = useForm();

  const { data: recetas = [], isLoading } = useQuery({
    queryKey: ['expediente-recetas', pacienteId],
    queryFn: () => api.get(`/expediente/pacientes/${pacienteId}/recetas`).then((r) => r.data),
  });

  const { data: medicos = [] } = useQuery({
    queryKey: ['medicos'],
    queryFn: () => api.get('/pos/medicos', { params: { admin: '1' } }).then((r) => r.data),
  });

  const crearMut = useMutation({
    mutationFn: (d) => api.post(`/expediente/pacientes/${pacienteId}/recetas`, {
      ...d,
      turno_id: turno?.id,
      partidas: partidas.filter((p) => p.medicamento_nombre.trim()),
    }),
    onSuccess: () => {
      toast.success('Receta generada');
      qc.invalidateQueries(['expediente-recetas', pacienteId]);
      setShowModal(false);
      reset();
      setPartidas([{ ...PARTIDA_VACIA }]);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  function actualizarPartida(idx, campo, valor) {
    setPartidas((ps) => ps.map((p, i) => (i === idx ? { ...p, [campo]: valor } : p)));
  }
  function agregarPartida() { setPartidas((ps) => [...ps, { ...PARTIDA_VACIA }]); }
  function quitarPartida(idx) { setPartidas((ps) => ps.filter((_, i) => i !== idx)); }

  function abrirModal() {
    reset({ medico_id: turno?.medico_id || '' });
    setPartidas([{ ...PARTIDA_VACIA }]);
    setShowModal(true);
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={abrirModal}
          disabled={!turno}
          title={!turno ? 'Abre un turno para emitir recetas' : ''}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={16} /> Nueva receta
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
      ) : recetas.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10 card">Sin recetas registradas</p>
      ) : (
        <div className="space-y-3">
          {recetas.map((r) => <RecetaCard key={r.id} receta={r} />)}
        </div>
      )}

      {showModal && (
        <Modal title="Nueva receta" onClose={() => setShowModal(false)} size="xl">
          <form onSubmit={handleSubmit((d) => crearMut.mutate(d))} className="space-y-4">
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              Medicamentos disponibles en: <strong>{turno?.sucursal_nombre}</strong>
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Médico que expide *</label>
                <select className="input" {...register('medico_id', { required: true })}>
                  <option value="">Selecciona…</option>
                  {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre} — {m.cedula_profesional}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Vigencia (días)</label>
                <input type="number" className="input" defaultValue={30} {...register('vigencia_dias')} />
              </div>
            </div>
            <div>
              <label className="label">Indicaciones generales</label>
              <textarea className="input min-h-[50px]" {...register('indicaciones_generales')} />
            </div>

            <div className="border-t border-gray-100 pt-3">
              <p className="label mb-2">Medicamentos</p>
              <div className="space-y-3">
                {partidas.map((p, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <div className="col-span-2 relative">
                          <div className="flex items-center gap-2">
                            <input
                              className="input flex-1"
                              placeholder="Buscar medicamento en existencias de la sucursal…"
                              value={p.medicamento_nombre}
                              onChange={(e) => {
                                actualizarPartida(idx, 'medicamento_nombre', e.target.value);
                                actualizarPartida(idx, 'producto_id', null);
                                actualizarPartida(idx, 'sku_interno', '');
                                setBuscandoIdx(idx);
                              }}
                              onFocus={() => setBuscandoIdx(idx)}
                            />
                            {p.producto_id && (
                              <span className="shrink-0 text-xs flex items-center gap-1 px-2 py-1.5 rounded-lg border border-green-200 bg-green-50 text-green-700">
                                <Link2 size={13} /> {p.sku_interno}
                              </span>
                            )}
                          </div>
                          {buscandoIdx === idx && (
                            <BuscadorMedicamentos
                              turnoId={turno?.id}
                              q={p.medicamento_nombre}
                              onSelect={(prod) => {
                                actualizarPartida(idx, 'producto_id', prod.id);
                                actualizarPartida(idx, 'sku_interno', prod.sku_interno);
                                actualizarPartida(idx, 'medicamento_nombre', prod.descripcion);
                                setBuscandoIdx(null);
                              }}
                              onClose={() => setBuscandoIdx(null)}
                            />
                          )}
                        </div>
                        <input className="input" placeholder="Presentación" value={p.presentacion}
                          onChange={(e) => actualizarPartida(idx, 'presentacion', e.target.value)} />
                        <input className="input" placeholder="Dosis" value={p.dosis}
                          onChange={(e) => actualizarPartida(idx, 'dosis', e.target.value)} />
                        <input className="input" placeholder="Vía de administración" value={p.via_administracion}
                          onChange={(e) => actualizarPartida(idx, 'via_administracion', e.target.value)} />
                        <input className="input" placeholder="Frecuencia" value={p.frecuencia}
                          onChange={(e) => actualizarPartida(idx, 'frecuencia', e.target.value)} />
                        <input className="input" placeholder="Duración" value={p.duracion}
                          onChange={(e) => actualizarPartida(idx, 'duracion', e.target.value)} />
                        <input type="number" min="0.01" step="0.01" className="input" placeholder="Cantidad" value={p.cantidad}
                          onChange={(e) => actualizarPartida(idx, 'cantidad', e.target.value)} />
                      </div>
                      {partidas.length > 1 && (
                        <button type="button" onClick={() => quitarPartida(idx)} className="text-xs text-red-400 hover:underline shrink-0 mt-2">
                          Quitar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={agregarPartida} className="text-xs text-brand-500 hover:underline mt-2">
                + Agregar medicamento
              </button>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={crearMut.isPending} className="btn-primary">
                {crearMut.isPending ? <Loader2 size={15} className="animate-spin" /> : null} Generar receta
              </button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// Autocomplete de medicamentos con existencia real en la sucursal del turno.
function BuscadorMedicamentos({ turnoId, q, onSelect, onClose }) {
  const { data = [], isFetching } = useQuery({
    queryKey: ['expediente-medicamentos', turnoId, q],
    queryFn: () => api.get('/expediente/medicamentos/buscar', { params: { turno_id: turnoId, q } }).then((r) => r.data),
    enabled: !!turnoId && q.trim().length >= 2,
  });

  if (!q || q.trim().length < 2) return null;

  return (
    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
      {isFetching ? (
        <p className="text-xs text-gray-400 text-center py-3"><Loader2 size={13} className="animate-spin inline mr-1" /> Buscando…</p>
      ) : data.length === 0 ? (
        <div className="px-3 py-2">
          <p className="text-xs text-gray-400">Sin existencias en esta sucursal para "{q}".</p>
          <button type="button" onClick={onClose} className="text-xs text-brand-500 hover:underline mt-1">
            Usar como texto libre
          </button>
        </div>
      ) : (
        data.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p)}
            className="w-full text-left px-3 py-2 hover:bg-brand-50 border-b border-gray-50 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-brand-600">{p.sku_interno}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${Number(p.existencia) > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {Number(p.existencia)} en existencia
              </span>
            </div>
            <p className="text-sm text-gray-700">{p.descripcion}</p>
          </button>
        ))
      )}
    </div>
  );
}

function RecetaCard({ receta }) {
  const [abierta, setAbierta] = useState(false);

  const { data: detalle } = useQuery({
    queryKey: ['expediente-receta', receta.id],
    queryFn: () => api.get(`/expediente/recetas/${receta.id}`).then((r) => r.data),
    enabled: abierta,
  });

  return (
    <div className="card">
      <button onClick={() => setAbierta((a) => !a)} className="w-full flex items-center justify-between text-left">
        <div>
          <p className="text-sm font-semibold text-gray-800">{receta.folio} · {fmt(receta.fecha)}</p>
          <p className="text-xs text-gray-400">{receta.medico_nombre}{receta.medico_cedula ? ` · Cédula ${receta.medico_cedula}` : ''}</p>
        </div>
        {abierta ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {abierta && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          {receta.indicaciones_generales && (
            <p className="text-sm text-gray-700 mb-2"><strong>Indicaciones:</strong> {receta.indicaciones_generales}</p>
          )}
          {!detalle ? (
            <p className="text-xs text-gray-400">Cargando partidas…</p>
          ) : (
            <table className="table-auto w-full text-sm">
              <thead>
                <tr>
                  <th>Medicamento</th><th>Presentación</th><th>Dosis</th><th>Vía</th><th>Frecuencia</th><th>Duración</th><th className="text-right">Cant.</th>
                </tr>
              </thead>
              <tbody>
                {detalle.partidas.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.medicamento_nombre}
                      {p.sku_interno && <span className="ml-2 text-[10px] font-mono text-green-600">{p.sku_interno}</span>}
                    </td>
                    <td>{p.presentacion || '—'}</td>
                    <td>{p.dosis || '—'}</td>
                    <td>{p.via_administracion || '—'}</td>
                    <td>{p.frecuencia || '—'}</td>
                    <td>{p.duracion || '—'}</td>
                    <td className="text-right">{p.cantidad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
