import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X, Loader2, Download, RefreshCw, Cog, Trash2, ShieldCheck, ShieldAlert, AlertTriangle, CalendarRange } from 'lucide-react';
import api from '../../services/api';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const fnum = (n) => Number(n || 0).toLocaleString('es-MX');
const fdate = (d) => (d ? new Date(d).toLocaleDateString('es-MX') : '—');
const fdatetime = (d) => (d ? new Date(d).toLocaleString('es-MX') : '—');

// ---- Estados de descarga del SAT ----------------------------------------
const ESTADO_OK = ['descargada', 'terminada'];
const ESTADO_ERR = ['error', 'rechazada', 'vencida'];
const estadoBadge = (estado) => {
  if (ESTADO_OK.includes(estado)) return 'inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700';
  if (ESTADO_ERR.includes(estado)) return 'inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700';
  return 'badge-gray';
};

export default function DescargasSat() {
  const [descargaOpen, setDescargaOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [purgarOpen, setPurgarOpen] = useState(false);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Descargas CFDI del SAT</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setPurgarOpen(true)}
            className="btn-secondary flex items-center gap-2 text-red-600 hover:border-red-300">
            <AlertTriangle size={15} /> Purgar todo
          </button>
          <button onClick={() => setBatchOpen(true)}
            className="btn-secondary flex items-center gap-2">
            <CalendarRange size={15} /> Carga histórica
          </button>
          <button onClick={() => setDescargaOpen(true)} className="btn-primary flex items-center gap-2">
            <Download size={15} /> Descargar del SAT
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-5">
        Solicita descargas masivas de CFDI por periodo y consulta la bitácora de procesamiento.
        Los comprobantes descargados se consultan en <strong>CFDI del SAT</strong>.
      </p>

      <BitacoraDescargas />

      {descargaOpen && <DescargaModal onClose={() => setDescargaOpen(false)} />}
      {batchOpen    && <BatchModal    onClose={() => setBatchOpen(false)} />}
      {purgarOpen   && <PurgarModal   onClose={() => setPurgarOpen(false)} />}
    </div>
  );
}

// ---- Bitácora de descargas del SAT ---------------------------------------
function BitacoraDescargas() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();

  const { data, isFetching } = useQuery({
    queryKey: ['cfdi-descargas'],
    queryFn: () => api.get('/cfdi/descargas').then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const rows = data?.rows || [];

  const procesarPendientes = useMutation({
    mutationFn: () => api.post('/cfdi/descargas/procesar-pendientes').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfdi-descargas'] }),
  });
  const procesarUno = useMutation({
    mutationFn: (id) => api.post(`/cfdi/descargas/${id}/procesar`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cfdi-descargas'] }),
  });
  const eliminar = useMutation({
    mutationFn: (id) => api.delete(`/cfdi/descargas/${id}`).then((r) => r.data),
    onSuccess: () => { toast.success('Registro eliminado'); qc.invalidateQueries({ queryKey: ['cfdi-descargas'] }); },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo eliminar'),
  });

  const borrar = async (r) => {
    const ok = await confirmar(
      `¿Eliminar este registro de la bitácora (${r.tipo}, ${fdate(r.fecha_desde)}–${fdate(r.fecha_hasta)})?\nLos CFDI ya importados NO se borran.`,
      { titulo: 'Eliminar registro', textoConfirmar: 'Eliminar' }
    );
    if (ok) eliminar.mutate(r.id);
  };

  const periodo = (r) => `${fdate(r.fecha_desde)} – ${fdate(r.fecha_hasta)}`;

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Bitácora de descargas del SAT</h2>
          <p className="text-xs text-gray-400">Solicitudes de descarga masiva y su procesamiento.</p>
        </div>
        <button
          onClick={() => procesarPendientes.mutate()}
          disabled={procesarPendientes.isPending}
          className="btn-secondary flex items-center gap-2">
          {procesarPendientes.isPending
            ? <Loader2 size={15} className="animate-spin" />
            : <RefreshCw size={15} />}
          Actualizar
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          {isFetching ? 'Cargando…' : 'No hay descargas registradas.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-auto w-full text-sm">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Periodo</th>
                <th>Estado</th>
                <th className="text-center">CFDIs</th>
                <th className="text-center">Importados</th>
                <th>Origen</th>
                <th>Fecha</th>
                <th className="text-center w-24">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="capitalize">{r.tipo}</span>
                    {r.request_type === 'metadata' && (
                      <span className="ml-1 inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700"
                        title="Reconciliación de estatus (vigente/cancelado) por metadata del SAT">Estatus</span>
                    )}
                  </td>
                  <td className="text-gray-600 text-xs">{periodo(r)}</td>
                  <td>
                    <span className={estadoBadge(r.estado)} title={r.mensaje || ''}>{r.estado}</span>
                  </td>
                  <td className="text-center">{fnum(r.num_cfdis)}</td>
                  <td className="text-center">{fnum(r.num_importados)}</td>
                  <td className="text-gray-500 text-xs">{r.origen || '—'}</td>
                  <td className="text-gray-400 text-xs">{fdatetime(r.updated_at || r.created_at)}</td>
                  <td>
                    <div className="flex items-center gap-2 justify-center">
                      <button
                        onClick={() => procesarUno.mutate(r.id)}
                        disabled={procesarUno.isPending}
                        className="text-gray-400 hover:text-brand-500 disabled:opacity-40"
                        title="Procesar esta descarga">
                        {procesarUno.isPending && procesarUno.variables === r.id
                          ? <Loader2 size={16} className="animate-spin" />
                          : <Cog size={16} />}
                      </button>
                      <button
                        onClick={() => borrar(r)}
                        disabled={eliminar.isPending}
                        className="text-gray-400 hover:text-red-500 disabled:opacity-40"
                        title="Eliminar de la bitácora">
                        {eliminar.isPending && eliminar.variables === r.id
                          ? <Loader2 size={16} className="animate-spin" />
                          : <Trash2 size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogoConfirm}
    </div>
  );
}

// ---- Modal: Purgar repositorio CFDI -------------------------------------
function PurgarModal({ onClose }) {
  const qc = useQueryClient();
  const [confirmado, setConfirmado] = useState(false);

  const purgar = useMutation({
    mutationFn: () => api.delete('/cfdi/repositorio').then((r) => r.data),
    onSuccess: (data) => {
      const e = data.eliminados;
      toast.success(`Repositorio purgado: ${e.comprobantes} comprobantes, ${e.conceptos} conceptos, ${e.descargas} descargas.`);
      qc.invalidateQueries({ queryKey: ['cfdi-descargas'] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al purgar'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-8">
        <div className="flex items-start gap-3 p-5 border-b border-red-100 bg-red-50 rounded-t-xl">
          <AlertTriangle size={22} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <div className="text-lg font-bold text-red-700">Purgar repositorio CFDI</div>
            <p className="text-sm text-red-600 mt-0.5">
              Esta acción elimina <strong>todos</strong> los comprobantes, conceptos y registros de
              bitácora. No se puede deshacer.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Los archivos XML en disco <strong>no se eliminan</strong>. Solo se borra la base de datos.
            Después usa <em>Carga histórica</em> para re-importar desde el SAT.
          </p>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4 accent-red-500"
              checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
            <span className="text-sm text-gray-700">Entiendo que esta acción es irreversible</span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={() => purgar.mutate()}
            disabled={!confirmado || purgar.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 flex items-center gap-2">
            {purgar.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Purgar todo
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Modal: Carga histórica batch ----------------------------------------
function BatchModal({ onClose }) {
  const qc = useQueryClient();
  const hoy = new Date();
  const [desdeAnio, setDesdeAnio] = useState(2019);
  const [desMes, setDesMes] = useState(3);

  // Calcular total de meses para mostrar al usuario.
  const totalMeses = (() => {
    let count = 0, a = desdeAnio, m = desMes;
    const hA = hoy.getFullYear(), hM = hoy.getMonth() + 1;
    while (a < hA || (a === hA && m <= hM)) { count++; m++; if (m > 12) { m = 1; a++; } }
    return count;
  })();

  const batch = useMutation({
    mutationFn: () => api.post('/cfdi/descargas/batch', { desde_anio: desdeAnio, desde_mes: desMes }).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data.mensaje || `${data.total} solicitudes enviadas al SAT.`);
      qc.invalidateQueries({ queryKey: ['cfdi-descargas'] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al programar batch'),
  });

  const anios = [];
  for (let y = hoy.getFullYear(); y >= 2018; y--) anios.push(y);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-8">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
          <div>
            <div className="text-lg font-bold text-gray-900">Carga histórica batch</div>
            <p className="text-xs text-gray-400 mt-0.5">
              Envía una solicitud de descarga al SAT por cada mes, emitidos y recibidos.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Desde</label>
            <div className="grid grid-cols-2 gap-3">
              <select className="input" value={desMes} onChange={(e) => setDesMes(Number(e.target.value))}>
                {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select className="input" value={desdeAnio} onChange={(e) => setDesdeAnio(Number(e.target.value))}>
                {anios.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="rounded-lg bg-blue-50 text-blue-700 text-sm px-4 py-3">
            Se enviarán <strong>{totalMeses * 2}</strong> solicitudes al SAT
            ({totalMeses} meses × emitidos + recibidos).
            El proceso corre en segundo plano (~2 seg por solicitud).
            Usa <em>Actualizar</em> en la bitácora para ver el avance.
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={() => batch.mutate()}
            disabled={batch.isPending || totalMeses === 0}
            className="btn-primary flex items-center gap-2">
            {batch.isPending ? <Loader2 size={15} className="animate-spin" /> : <CalendarRange size={15} />}
            Iniciar batch
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Modal de descarga del SAT -------------------------------------------
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

function DescargaModal({ onClose }) {
  const qc = useQueryClient();
  const def = mesAnterior();
  const [tipo, setTipo] = useState('emitido');     // 'emitido' | 'recibido' | 'ambos'
  const [modoPeriodo, setModoPeriodo] = useState('mes'); // 'mes' | 'rango'
  const [anio, setAnio] = useState(def.anio);
  const [mes, setMes] = useState(def.mes);
  // Rango: por defecto el mes anterior completo.
  const [desde, setDesde] = useState(`${def.anio}-${String(def.mes).padStart(2, '0')}-01`);
  const [hasta, setHasta] = useState(hoyISO());

  const { data: fiel } = useQuery({
    queryKey: ['cfdi-fiel'],
    queryFn: () => api.get('/cfdi/fiel').then((r) => r.data),
  });

  // Cuerpo del periodo según el modo elegido.
  const periodoBody = () =>
    modoPeriodo === 'rango' ? { desde, hasta } : { anio: Number(anio), mes: Number(mes) };

  const solicitar = useMutation({
    mutationFn: () => api.post('/cfdi/descargas', { tipo, ...periodoBody() }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cfdi-descargas'] });
      onClose();
    },
  });

  const reconciliar = useMutation({
    mutationFn: () => api.post('/cfdi/estatus/reconciliar', { tipo, ...periodoBody() }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cfdi-descargas'] }); onClose(); },
  });

  const anios = [];
  for (let y = new Date().getFullYear(); y >= 2018; y--) anios.push(y);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-8">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
          <div>
            <div className="text-lg font-bold text-gray-900">Descargar del SAT</div>
            <p className="text-xs text-gray-400 mt-0.5">Solicita una descarga masiva de CFDI por periodo.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Estado e.firma */}
          {fiel && (
            <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${fiel.valida ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {fiel.valida ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
              <span>
                e.firma {fiel.valida ? 'vigente' : 'no válida'}
                {fiel.rfc ? `  ·  ${fiel.rfc}` : ''}
                {fiel.serie ? `  ·  serie ${fiel.serie}` : ''}
              </span>
            </div>
          )}

          <div>
            <label className="label">Tipo de comprobantes</label>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 w-full">
              {[['emitido', 'Emitidos'], ['recibido', 'Recibidos'], ['ambos', 'Ambos']].map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setTipo(k)}
                  className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                    ${tipo === k ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Periodo</label>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 w-full mb-2">
              {[['mes', 'Por mes'], ['rango', 'Rango de fechas']].map(([k, l]) => (
                <button key={k} onClick={() => setModoPeriodo(k)}
                  className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                    ${modoPeriodo === k ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                  {l}
                </button>
              ))}
            </div>
            {modoPeriodo === 'mes' ? (
              <div className="grid grid-cols-2 gap-3">
                <select className="input" value={mes} onChange={(e) => setMes(e.target.value)}>
                  {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select className="input" value={anio} onChange={(e) => setAnio(e.target.value)}>
                  {anios.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-gray-400">Desde</span>
                  <input type="date" className="input" value={desde} max={hasta || hoyISO()} onChange={(e) => setDesde(e.target.value)} />
                </div>
                <div>
                  <span className="text-xs text-gray-400">Hasta</span>
                  <input type="date" className="input" value={hasta} max={hoyISO()} onChange={(e) => setHasta(e.target.value)} />
                </div>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-1">
              El SAT solo permite rangos dentro de los últimos 6 años y sin fecha final futura.
            </p>
          </div>

          {(solicitar.isError || reconciliar.isError) && (
            <p className="text-sm text-red-500">
              {(solicitar.error || reconciliar.error)?.response?.data?.error || 'No se pudo completar la operación.'}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-5 border-t border-gray-100">
          <button
            onClick={() => reconciliar.mutate()}
            disabled={reconciliar.isPending || solicitar.isPending}
            title="Descarga solo la metadata del SAT y actualiza vigente/cancelado de lo ya cargado"
            className="btn-secondary flex items-center gap-2 text-xs">
            {reconciliar.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Solo actualizar estatus
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              onClick={() => solicitar.mutate()}
              disabled={solicitar.isPending || reconciliar.isPending}
              className="btn-primary flex items-center gap-2">
              {solicitar.isPending
                ? <Loader2 size={15} className="animate-spin" />
                : <Download size={15} />}
              Solicitar descarga
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
