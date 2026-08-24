import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ShieldAlert, ShieldCheck, Loader2, Plus, Trash2, AlertTriangle, CheckCircle2, Landmark,
} from 'lucide-react';
import api from '../../services/api';
import CuentaContableSelect from '../../components/shared/CuentaContableSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FILA_VACIA = { cuenta_codigo: '', cargo: 0, abono: 0, concepto: '' };

const CHECKLIST = [
  { id: 'banco', texto: 'El saldo de banco cuadra contra el estado de cuenta del corte elegido.' },
  { id: 'cartera', texto: 'La cartera de clientes y proveedores cuadra contra su antigüedad de saldos (aging) real, no un estimado.' },
  { id: 'inventario', texto: 'El inventario cuadra contra un conteo físico (o el kardex del sistema) a esa fecha, no una cifra inventada.' },
  { id: 'activo_fijo', texto: 'El activo fijo y su depreciación acumulada vienen del papel de trabajo del contador.' },
];

/**
 * Fase A del plan de corrección del módulo contable (2026-08-24): asistente de carga
 * de saldos iniciales. El sistema NO asume que existe un punto de partida real — la
 * apertura de enero 2026 original fue un dato de PRUEBA (ficticio), no la balanza real
 * del contador. Esta pantalla reemplaza esa apertura por una real y verificada, o la
 * quita para arrancar el ejercicio en $0 mientras no exista una balanza confiable.
 */
export default function Apertura() {
  const qc = useQueryClient();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [fechaCorte, setFechaCorte] = useState(`${hoy.getFullYear()}-01-31`);
  const [movs, setMovs] = useState([{ ...FILA_VACIA }, { ...FILA_VACIA }]);
  const [checklist, setChecklist] = useState({});
  const { confirmar, dialogoConfirm } = useConfirm();

  const estadoQ = useQuery({
    queryKey: ['contab-apertura', anio],
    queryFn: () => api.get('/contabilidad/apertura', { params: { anio } }).then((r) => r.data),
  });

  // Al cambiar de año o al cargar los datos existentes, precarga el formulario.
  useEffect(() => {
    if (!estadoQ.data) return;
    if (estadoQ.data.poliza) {
      setFechaCorte(String(estadoQ.data.poliza.fecha).slice(0, 10));
      setMovs(estadoQ.data.movimientos.map((m) => ({
        cuenta_codigo: m.cuenta_codigo, cargo: Number(m.cargo) || 0,
        abono: Number(m.abono) || 0, concepto: m.concepto || '',
      })));
    } else {
      setFechaCorte(`${anio}-01-31`);
      setMovs([{ ...FILA_VACIA }, { ...FILA_VACIA }]);
    }
    setChecklist({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estadoQ.data]);

  const setMov = (i, campo, valor) => setMovs((a) => a.map((m, j) => (j === i ? { ...m, [campo]: valor } : m)));
  const addMov = () => setMovs((a) => [...a, { ...FILA_VACIA }]);
  const delMov = (i) => setMovs((a) => a.filter((_, j) => j !== i));

  const totCargos = r2(movs.reduce((s, m) => s + (Number(m.cargo) || 0), 0));
  const totAbonos = r2(movs.reduce((s, m) => s + (Number(m.abono) || 0), 0));
  const cuadra = Math.abs(totCargos - totAbonos) < 0.01 && totCargos > 0;
  const checklistCompleto = CHECKLIST.every((c) => checklist[c.id]);

  const guardarMut = useMutation({
    mutationFn: (verificada) => api.post('/contabilidad/apertura', {
      anio, fecha_corte: fechaCorte, verificada,
      movimientos: movs
        .filter((m) => m.cuenta_codigo && (Number(m.cargo) || Number(m.abono)))
        .map((m) => ({ cuenta_codigo: m.cuenta_codigo, cargo: Number(m.cargo) || 0,
                       abono: Number(m.abono) || 0, concepto: m.concepto || null })),
    }),
    onSuccess: (r) => {
      const d = r.data;
      toast.success(d.verificada ? 'Apertura guardada y VERIFICADA' : 'Apertura guardada como provisional');
      if (d.avisos?.length) d.avisos.forEach((a) => toast(a, { icon: '⚠️', duration: 8000 }));
      qc.invalidateQueries({ queryKey: ['contab-apertura'] });
      qc.invalidateQueries({ queryKey: ['contab'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  const eliminarMut = useMutation({
    mutationFn: () => api.delete('/contabilidad/apertura', { params: { anio } }),
    onSuccess: () => {
      toast.success('Apertura eliminada — el ejercicio arranca en $0');
      qc.invalidateQueries({ queryKey: ['contab-apertura'] });
      qc.invalidateQueries({ queryKey: ['contab'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const estado = estadoQ.data;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Landmark size={22} className="text-brand-500" /> Saldos iniciales / Apertura
        </h1>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">
          El sistema no asume que hay un punto de partida contable real. Mientras no cargues y
          confirmes una balanza verificada con el contador, los 3 reportes (Estado de Resultados,
          Balance General, Balanza) muestran una advertencia y no deben tomarse como cifras oficiales.
        </p>
      </div>

      <div className="card mb-4">
        <div className="flex items-end gap-3">
          <div>
            <label className="label">Ejercicio</label>
            <input type="number" className="input w-28" value={anio}
              onChange={(e) => setAnio(parseInt(e.target.value, 10) || hoy.getFullYear())} />
          </div>
          {estado && <EstadoBadge estado={estado} />}
        </div>
      </div>

      {estadoQ.isLoading ? (
        <div className="card text-sm text-gray-400 flex items-center gap-2 py-10 justify-center">
          <Loader2 className="animate-spin" size={16} /> Cargando…
        </div>
      ) : (
        <>
          <div className="card mb-4">
            <label className="label">Fecha de corte de la balanza</label>
            <p className="text-xs text-gray-400 mb-2">
              Usa el cierre más reciente ya conciliado con el contador — no tiene que ser enero.
              Cuanto más cercano a hoy, menos historial hay que reconstruir a mano.
            </p>
            <input type="date" className="input w-48" value={fechaCorte}
              onChange={(e) => setFechaCorte(e.target.value)} />
          </div>

          <div className="card mb-4">
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Cuentas y saldos</label>
              <button onClick={addMov} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                <Plus size={13} /> Agregar cuenta
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="text-left">Cuenta</th>
                  <th className="text-right w-32">Cargo (Deudor)</th>
                  <th className="text-right w-32">Abono (Acreedor)</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {movs.map((m, i) => (
                  <tr key={i}>
                    <td className="pr-2 py-1">
                      <CuentaContableSelect value={m.cuenta_codigo}
                        onChange={(v) => setMov(i, 'cuenta_codigo', v)} placeholder="Cuenta…" />
                    </td>
                    <td className="py-1">
                      <input type="number" step="0.01" className="input text-right" value={m.cargo || ''}
                        onChange={(e) => { setMov(i, 'cargo', e.target.value); if (e.target.value) setMov(i, 'abono', 0); }} />
                    </td>
                    <td className="py-1">
                      <input type="number" step="0.01" className="input text-right" value={m.abono || ''}
                        onChange={(e) => { setMov(i, 'abono', e.target.value); if (e.target.value) setMov(i, 'cargo', 0); }} />
                    </td>
                    <td className="text-center">
                      {movs.length > 2 && (
                        <button onClick={() => delMov(i)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 font-medium">
                  <td className="text-right text-xs text-gray-500 pt-2">Sumas</td>
                  <td className="text-right font-mono pt-2">{money(totCargos)}</td>
                  <td className="text-right font-mono pt-2">{money(totAbonos)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
            <div className="mt-2">
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${cuadra ? 'text-green-600' : 'text-red-600'}`}>
                {cuadra ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {cuadra ? 'Cuadra' : 'No cuadra (o está vacío)'}
              </span>
            </div>
          </div>

          <div className="card mb-4">
            <label className="label">Checklist de verificación</label>
            <p className="text-xs text-gray-400 mb-3">
              Márcalos solo si de verdad los revisaste. Son la diferencia entre una apertura
              "verificada" (cifra oficial) y una "provisional" (dato de arranque sin auditar).
            </p>
            <div className="space-y-2">
              {CHECKLIST.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" className="h-4 w-4 mt-0.5 accent-brand-500"
                    checked={!!checklist[c.id]}
                    onChange={(e) => setChecklist((s) => ({ ...s, [c.id]: e.target.checked }))} />
                  {c.texto}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => guardarMut.mutate(false)} disabled={!cuadra || guardarMut.isPending}
              className="btn-secondary">
              {guardarMut.isPending && <Loader2 size={15} className="animate-spin" />}
              Guardar como provisional
            </button>
            <button onClick={() => guardarMut.mutate(true)}
              disabled={!cuadra || !checklistCompleto || guardarMut.isPending}
              className="btn-primary" title={!checklistCompleto ? 'Marca todo el checklist primero' : ''}>
              {guardarMut.isPending && <Loader2 size={15} className="animate-spin" />}
              <ShieldCheck size={15} /> Guardar y marcar VERIFICADA
            </button>
            {estado?.existe && (
              <button
                onClick={async () => {
                  if (await confirmar(
                    `¿Eliminar la apertura de ${anio}? El ejercicio quedará sin saldos iniciales (todo en $0) hasta cargar una nueva.`,
                    { titulo: 'Eliminar apertura', textoConfirmar: 'Eliminar' }
                  )) eliminarMut.mutate();
                }}
                disabled={eliminarMut.isPending}
                className="btn-secondary text-red-600 ml-auto">
                <Trash2 size={15} /> Eliminar apertura de {anio}
              </button>
            )}
          </div>
        </>
      )}
      {dialogoConfirm}
    </div>
  );
}

function EstadoBadge({ estado }) {
  if (!estado.existe) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1.5 rounded-lg">
        <ShieldAlert size={15} /> Sin apertura cargada para este ejercicio
      </span>
    );
  }
  if (!estado.verificada) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 bg-amber-100 px-3 py-1.5 rounded-lg">
        <ShieldAlert size={15} /> PROVISIONAL (sin verificar con el contador)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-800 bg-green-100 px-3 py-1.5 rounded-lg">
      <ShieldCheck size={15} /> Verificada · corte {String(estado.fecha_corte).slice(0, 10)}
    </span>
  );
}
