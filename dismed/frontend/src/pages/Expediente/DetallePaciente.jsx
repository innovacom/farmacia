import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Loader2, Plus, Stethoscope, FileText, ClipboardList,
  ChevronDown, ChevronUp, Link2, ShoppingCart,
} from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import ProductoPicker from '../../components/shared/ProductoPicker';

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

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {paciente.nombre} {paciente.apellido_paterno} {paciente.apellido_materno}
          </h1>
          <p className="text-sm text-gray-400">{paciente.cliente_nombre}</p>
        </div>
      </div>

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
      {tab === 'consultas' && <Consultas pacienteId={id} />}
      {tab === 'recetas' && <Recetas pacienteId={id} clienteId={paciente.cliente_id} />}
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

function Consultas({ pacienteId }) {
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
      return api.post(`/expediente/pacientes/${pacienteId}/consultas`, { ...resto, signos_vitales });
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
        <button onClick={() => { reset({}); setShowModal(true); }} className="btn-primary">
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
                <p className="text-xs text-gray-400">{c.medico_nombre || c.capturado_por}{c.medico_cedula ? ` · Cédula ${c.medico_cedula}` : ''}</p>
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
            <div className="grid grid-cols-3 gap-4">
              <div><label className="label">Pronóstico</label><input className="input" {...register('pronostico')} /></div>
              <div><label className="label">Médico (si no es el usuario que captura)</label><input className="input" {...register('medico_nombre')} /></div>
              <div><label className="label">Cédula profesional</label><input className="input" {...register('medico_cedula')} /></div>
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

function Recetas({ pacienteId, clienteId }) {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [partidas, setPartidas] = useState([{ ...PARTIDA_VACIA }]);
  const [pickerIdx, setPickerIdx] = useState(null);
  const { register, handleSubmit, reset } = useForm();

  const { data: recetas = [], isLoading } = useQuery({
    queryKey: ['expediente-recetas', pacienteId],
    queryFn: () => api.get(`/expediente/pacientes/${pacienteId}/recetas`).then((r) => r.data),
  });

  const crearMut = useMutation({
    mutationFn: (d) => api.post(`/expediente/pacientes/${pacienteId}/recetas`, {
      ...d,
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

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => { reset({}); setPartidas([{ ...PARTIDA_VACIA }]); setShowModal(true); }} className="btn-primary">
          <Plus size={16} /> Nueva receta
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
      ) : recetas.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10 card">Sin recetas registradas</p>
      ) : (
        <div className="space-y-3">
          {recetas.map((r) => <RecetaCard key={r.id} receta={r} pacienteId={pacienteId} />)}
        </div>
      )}

      {showModal && (
        <Modal title="Nueva receta" onClose={() => setShowModal(false)} size="xl">
          <form onSubmit={handleSubmit((d) => crearMut.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div><label className="label">Médico (si no es el usuario que captura)</label><input className="input" {...register('medico_nombre')} /></div>
              <div><label className="label">Cédula profesional</label><input className="input" {...register('medico_cedula')} /></div>
              <div><label className="label">Vigencia (días)</label><input type="number" className="input" defaultValue={30} {...register('vigencia_dias')} /></div>
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
                        <div className="col-span-2 flex items-center gap-2">
                          <input
                            className="input flex-1"
                            placeholder="Medicamento / insumo *"
                            value={p.medicamento_nombre}
                            onChange={(e) => actualizarPartida(idx, 'medicamento_nombre', e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => setPickerIdx(idx)}
                            className={`shrink-0 text-xs flex items-center gap-1 px-2 py-1.5 rounded-lg border ${
                              p.producto_id ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                            title="Vincular con el catálogo DISMED"
                          >
                            <Link2 size={13} /> {p.sku_interno || 'Vincular'}
                          </button>
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

          <ProductoPicker
            open={pickerIdx !== null}
            onClose={() => setPickerIdx(null)}
            partida={{ descripcion_original: partidas[pickerIdx]?.medicamento_nombre }}
            clienteId={clienteId}
            onSelect={(prod) => {
              actualizarPartida(pickerIdx, 'producto_id', prod.id);
              actualizarPartida(pickerIdx, 'sku_interno', prod.sku_interno);
              if (!partidas[pickerIdx].medicamento_nombre) actualizarPartida(pickerIdx, 'medicamento_nombre', prod.descripcion);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function RecetaCard({ receta, pacienteId }) {
  const qc = useQueryClient();
  const [abierta, setAbierta] = useState(false);

  const { data: detalle } = useQuery({
    queryKey: ['expediente-receta', receta.id],
    queryFn: () => api.get(`/expediente/recetas/${receta.id}`).then((r) => r.data),
    enabled: abierta,
  });

  const generarMut = useMutation({
    mutationFn: () => api.post(`/expediente/recetas/${receta.id}/generar-solicitud`),
    onSuccess: (r) => {
      toast.success(`Solicitud ${r.data.folio} generada`);
      qc.invalidateQueries(['expediente-recetas', pacienteId]);
      qc.invalidateQueries(['expediente-receta', receta.id]);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const tieneVinculados = detalle?.partidas?.some((p) => p.producto_id);

  return (
    <div className="card">
      <button onClick={() => setAbierta((a) => !a)} className="w-full flex items-center justify-between text-left">
        <div>
          <p className="text-sm font-semibold text-gray-800">{receta.folio} · {fmt(receta.fecha)}</p>
          <p className="text-xs text-gray-400">{receta.medico_nombre}{receta.medico_cedula ? ` · Cédula ${receta.medico_cedula}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {receta.solicitud_folio && (
            <Link
              to={`/solicitudes/${receta.solicitud_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-brand-500 hover:underline flex items-center gap-1"
            >
              <ShoppingCart size={12} /> {receta.solicitud_folio}
            </Link>
          )}
          {abierta ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
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

          {!receta.solicitud_id && tieneVinculados && (
            <button onClick={() => generarMut.mutate()} disabled={generarMut.isPending} className="btn-secondary btn-sm mt-3">
              {generarMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <ShoppingCart size={13} />}
              Generar solicitud de cotización
            </button>
          )}
        </div>
      )}
    </div>
  );
}
