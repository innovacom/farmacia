import { useState, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  BookText, RefreshCw, Loader2, ChevronRight, ChevronDown, CheckCircle2, AlertTriangle,
  Plus, Trash2, Pencil, X, ShieldCheck, Undo2, Search, Package,
} from 'lucide-react';
import api from '../../services/api';
import CuentaContableSelect from '../../components/shared/CuentaContableSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { usePermisos } from '../../hooks/usePermisos';
import { abrirPdfCfdi } from '../../utils/cfdiPdf';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre', 'Cierre (13)'];

const METODOS_INV = [
  ['perpetuo', 'Perpetuo — costo por salidas del kardex'],
  ['periodico', 'Periódico — inventario inicial + compras − inventario final'],
  ['compras', 'Compras = costo — compras netas de mercancía del periodo'],
];
const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TIPO_BADGE = { ingreso: 'badge-green', egreso: 'badge-red', diario: 'badge-blue' };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function Cuadre({ cuadra, cargos, abonos }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cuadra ? 'text-green-600' : 'text-red-600'}`}>
      {cuadra ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {cuadra ? 'Cuadra' : 'Descuadre'} · cargos {money(cargos)} / abonos {money(abonos)}
    </span>
  );
}

export default function Polizas() {
  const qc = useQueryClient();
  const { isAdmin } = usePermisos();
  const hoy = new Date();
  const [anioTxt, setAnioTxt] = useState(String(hoy.getFullYear())); // texto crudo, captura libre
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [q, setQ] = useState('');
  const [vista, setVista] = useState('polizas');
  const [abiertas, setAbiertas] = useState(() => new Set()); // ids de pólizas con detalle expandido (varias a la vez)
  const toggleAbierta = (id) => setAbiertas((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const [editor, setEditor] = useState(null); // { poliza } | { nueva:true } | null
  const [soloRevisar, setSoloRevisar] = useState(false);

  const anio = parseInt(anioTxt, 10) || hoy.getFullYear();
  const params = { anio, mes, q: q.trim() || undefined, revisar: soloRevisar ? '1' : undefined };
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['polizas'] });
    qc.invalidateQueries({ queryKey: ['polizas-balanza'] });
    qc.invalidateQueries({ queryKey: ['contab-invper'] });
  };

  const polizasQ = useQuery({
    queryKey: ['polizas', anio, mes, q, soloRevisar],
    queryFn: () => api.get('/contabilidad/polizas', { params }).then((r) => r.data),
    keepPreviousData: true,
  });
  const balanzaQ = useQuery({
    queryKey: ['polizas-balanza', anio, mes],
    queryFn: () => api.get('/contabilidad/polizas/balanza', { params }).then((r) => r.data),
    keepPreviousData: true,
    enabled: vista === 'balanza',
  });

  const generarMut = useMutation({
    mutationFn: () => api.post('/contabilidad/polizas/generar', { anio, mes }).then((r) => r.data),
    onSuccess: (d) => {
      const met = d.metodo_inventario ? ` · costeo ${d.metodo_inventario}` : '';
      toast.success(`${d.generadas} pólizas generadas · ${d.cfdis_procesados} CFDI${met}`);
      if (d.por_revisar > 0) {
        toast(`${d.por_revisar} póliza${d.por_revisar > 1 ? 's' : ''} requiere${d.por_revisar > 1 ? 'n' : ''} revisión`,
          { icon: '⚠️', duration: 6000 });
      }
      invalidar();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al generar'),
  });
  const confirmarMut = useMutation({
    mutationFn: () => api.post('/contabilidad/polizas/confirmar', { anio, mes }).then((r) => r.data),
    onSuccess: (d) => { toast.success(`${d.confirmadas} pólizas confirmadas`); invalidar(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const data = polizasQ.data;
  const polizas = data?.polizas || [];
  const bal = balanzaQ.data;
  const borradores = polizas.filter((p) => p.estado === 'borrador').length;
  const porRevisar = data?.por_revisar || 0;

  // Doble clic sobre una póliza generada de CFDI abre la representación
  // impresa (PDF) del comprobante que la originó — mismo formato que en
  // Consultas > Facturas CFDI. Las pólizas manuales o de inventario no
  // tienen cfdi_id y no hacen nada.
  const verCfdi = (p) => {
    if (!p.cfdi_id) return;
    abrirPdfCfdi(p.cfdi_id);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookText size={22} className="text-brand-500" /> Pólizas contables
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Asientos derivados de CFDI e inventario. Revisa, confirma o edita antes de reportar.
            Doble clic en una póliza que venga de un CFDI para ver su representación impresa (PDF).
          </p>
        </div>
      </div>

      {/* Controles de periodo */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Año</label>
            <input type="number" className="input w-28" value={anioTxt} min="2000" max="2100"
              onChange={(e) => setAnioTxt(e.target.value)} />
          </div>
          <div>
            <label className="label">Mes</label>
            <select className="input w-40" value={mes} onChange={(e) => setMes(parseInt(e.target.value, 10))}>
              {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          {vista === 'polizas' && (
            <div className="relative">
              <label className="label">Buscar</label>
              <Search size={15} className="absolute left-2.5 top-1/2 translate-y-[2px] text-gray-400" />
              <input className="input pl-8 w-64" placeholder="Cliente, proveedor, banco, cuenta, folio, UUID…"
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <button onClick={() => generarMut.mutate()} disabled={generarMut.isPending} className="btn-primary">
            {generarMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Generar
          </button>
          <button onClick={() => confirmarMut.mutate()} disabled={confirmarMut.isPending || !borradores}
            className="btn-secondary" title="Confirma todas las pólizas en borrador del periodo">
            <ShieldCheck size={16} /> Confirmar borradores{borradores ? ` (${borradores})` : ''}
          </button>
          {(porRevisar > 0 || soloRevisar) && (
            <button onClick={() => setSoloRevisar((v) => !v)}
              className={`btn-secondary ${soloRevisar ? 'ring-2 ring-amber-400' : ''} ${porRevisar > 0 ? 'text-amber-700' : ''}`}
              title="Pólizas autogeneradas que el motor no pudo registrar con certeza — revísalas y edítalas si hace falta">
              <AlertTriangle size={16} /> {soloRevisar ? 'Ver todas' : `Por revisar${porRevisar ? ` (${porRevisar})` : ''}`}
            </button>
          )}
          <button onClick={() => setEditor({ nueva: true })} className="btn-secondary">
            <Plus size={16} /> Póliza manual
          </button>
          <div className="ml-auto flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setVista('polizas')}
              className={`px-4 py-2 text-sm ${vista === 'polizas' ? 'bg-brand-500 text-white' : 'bg-white text-gray-600'}`}>
              Pólizas
            </button>
            <button onClick={() => setVista('balanza')}
              className={`px-4 py-2 text-sm ${vista === 'balanza' ? 'bg-brand-500 text-white' : 'bg-white text-gray-600'}`}>
              Balanza por cuenta
            </button>
          </div>
        </div>
        {generarMut.data && (
          <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>Banco de movimientos: <b>{generarMut.data.banco_cuenta}</b></span>
            <span>Costo de venta (inventario): <b>${money(generarMut.data.costo_venta_inventario)}</b> ({generarMut.data.salidas_inventario} salidas)</span>
            {generarMut.data.ajustes_inventario > 0 && (
              <span>
                Ajustes físicos: <b>{generarMut.data.ajustes_inventario}</b> · neto{' '}
                <b className={generarMut.data.ajuste_inventario_neto < 0 ? 'text-red-600' : 'text-green-600'}>
                  ${money(generarMut.data.ajuste_inventario_neto)}
                </b>{' '}
                ({generarMut.data.ajuste_inventario_neto < 0 ? 'merma' : 'sobrante'})
              </span>
            )}
            <Cuadre cuadra={generarMut.data.cuadra} cargos={generarMut.data.total_cargos} abonos={generarMut.data.total_abonos} />
          </div>
        )}
      </div>

      <CosteoInventario anio={anio} mes={mes} isAdmin={isAdmin} onSaved={invalidar} />

      {/* Vista: Pólizas */}
      {vista === 'polizas' && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-500">
              {polizasQ.isLoading ? 'Cargando…' : `${polizas.length} pólizas — ${MESES[mes - 1]} ${anio}`}
            </p>
            {data && polizas.length > 0 && (
              <Cuadre cuadra={Math.abs(data.total_cargos - data.total_abonos) < 0.05}
                cargos={data.total_cargos} abonos={data.total_abonos} />
            )}
          </div>
          <table className="table-auto w-full text-sm">
            <thead>
              <tr>
                <th className="w-8"></th>
                <th className="w-24">Fecha</th>
                <th className="w-24">Tipo</th>
                <th>Concepto</th>
                <th className="w-24 text-center">Estado</th>
                <th className="text-right w-32">Cargos</th>
                <th className="text-right w-32">Abonos</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {polizas.map((p) => (
                <Fragment key={p.id}>
                  <tr className="hover:bg-gray-50" onDoubleClick={() => verCfdi(p)}
                    title={p.cfdi_id ? 'Doble clic para ver el CFDI (PDF)' : undefined}>
                    <td className="text-gray-400 cursor-pointer" onClick={() => toggleAbierta(p.id)}>
                      {abiertas.has(p.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </td>
                    <td className="text-gray-500">{String(p.fecha).slice(0, 10)}</td>
                    <td><span className={`badge text-xs ${TIPO_BADGE[p.tipo] || 'badge-gray'}`}>{p.tipo}</span></td>
                    <td className="text-gray-700">
                      {p.concepto}
                      {p.referencia && <span className="text-gray-400 text-xs ml-2">{p.referencia}</span>}
                      {p.origen === 'apertura' && <span className="ml-2 text-[10px] text-brand-600">apertura</span>}
                      {p.origen === 'manual' && <span className="ml-2 text-[10px] text-purple-600">manual</span>}
                      {!!p.revisar && (
                        <span className="ml-2 inline-flex items-center gap-1 badge text-[10px] bg-amber-100 text-amber-800 align-middle"
                          title={p.revisar_motivo || 'Requiere revisión manual'}>
                          <AlertTriangle size={11} /> revisar
                        </span>
                      )}
                      {!!p.revisar && p.revisar_motivo && (
                        <span className="block text-[11px] text-amber-700 mt-0.5">{p.revisar_motivo}</span>
                      )}
                    </td>
                    <td className="text-center">
                      {p.estado === 'confirmada'
                        ? <span className="badge-green text-xs">Confirmada</span>
                        : <span className="badge-gray text-xs">Borrador</span>}
                    </td>
                    <td className="text-right font-mono text-gray-700">{money(p.total_cargos)}</td>
                    <td className="text-right font-mono text-gray-700">{money(p.total_abonos)}</td>
                    <td className="text-right">
                      <button onClick={() => setEditor({ poliza: p })} className="text-gray-400 hover:text-brand-600" title="Editar">
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                  {abiertas.has(p.id) && (
                    <tr onDoubleClick={() => verCfdi(p)}>
                      <td></td>
                      <td colSpan={7} className="bg-gray-50/70">
                        <table className="w-full text-xs my-1">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="text-left w-24">Cuenta</th>
                              <th className="text-left">Nombre / concepto</th>
                              <th className="text-right w-28">Cargo</th>
                              <th className="text-right w-28">Abono</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.movimientos.map((m, i) => (
                              <tr key={i}>
                                <td className="font-mono text-gray-500">{m.cuenta_codigo}</td>
                                <td className="text-gray-600">
                                  {m.cuenta_nombre || '—'}
                                  {m.concepto && <span className="text-gray-400"> · {m.concepto}</span>}
                                </td>
                                <td className="text-right font-mono">{m.cargo > 0 ? money(m.cargo) : ''}</td>
                                <td className="text-right font-mono">{m.abono > 0 ? money(m.abono) : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!polizasQ.isLoading && polizas.length === 0 && (
                <tr><td colSpan={8} className="text-center text-gray-400 py-8">
                  {q.trim() ? 'Sin pólizas que coincidan con la búsqueda.' : 'Sin pólizas en este periodo. Usa «Generar».'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Vista: Balanza por cuenta real */}
      {vista === 'balanza' && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-500">
              {balanzaQ.isLoading ? 'Cargando…' : `${bal?.total_cuentas ?? 0} cuentas con movimiento — ${MESES[mes - 1]} ${anio}`}
            </p>
            {bal && <Cuadre cuadra={bal.cuadra} cargos={bal.total_cargos} abonos={bal.total_abonos} />}
          </div>
          <table className="table-auto w-full text-sm">
            <thead>
              <tr>
                <th className="w-24">Cuenta</th><th>Nombre</th><th className="w-32">Rubro</th>
                <th className="text-right w-32">Cargos</th><th className="text-right w-32">Abonos</th>
                <th className="text-right w-32">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {(bal?.cuentas || []).map((c) => (
                <tr key={c.codigo}>
                  <td className="font-mono text-gray-500">{c.codigo}</td>
                  <td className="text-gray-700">{c.nombre || '—'}</td>
                  <td className="text-gray-400">{c.rubro || '—'}</td>
                  <td className="text-right font-mono text-gray-600">{money(c.cargos)}</td>
                  <td className="text-right font-mono text-gray-600">{money(c.abonos)}</td>
                  <td className="text-right font-mono font-medium text-gray-900">{money(c.saldo)}</td>
                </tr>
              ))}
              {!balanzaQ.isLoading && (!bal?.cuentas || bal.cuentas.length === 0) && (
                <tr><td colSpan={6} className="text-center text-gray-400 py-8">Sin movimientos. Genera las pólizas primero.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <PolizaEditor
          poliza={editor.poliza}
          anio={anio} mes={mes}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); invalidar(); }}
        />
      )}
    </div>
  );
}

// ── Costeo de inventario del ejercicio (método + inventario final por periodo) ──
function CosteoInventario({ anio, mes, isAdmin, onSaved }) {
  const qc = useQueryClient();
  const ejQ = useQuery({
    queryKey: ['contab-ejercicio', anio],
    queryFn: () => api.get('/contabilidad/ejercicio', { params: { anio } }).then((r) => r.data),
  });
  const metodo = ejQ.data?.metodo_inventario || 'perpetuo';

  const metodoMut = useMutation({
    mutationFn: (m) => api.put('/contabilidad/ejercicio', { anio, metodo_inventario: m }).then((r) => r.data),
    onSuccess: (d) => {
      qc.setQueryData(['contab-ejercicio', anio], d);
      qc.invalidateQueries({ queryKey: ['contab-invper'] });
      toast.success(`Método de costeo ${anio}: ${d.metodo_inventario}`);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo cambiar el método'),
  });

  const esPeriodico = metodo === 'periodico';
  const invQ = useQuery({
    queryKey: ['contab-invper', anio, mes],
    queryFn: () => api.get('/contabilidad/inventario-periodo', { params: { anio, mes } }).then((r) => r.data),
    enabled: esPeriodico,
  });

  const [valor, setValor] = useState('');
  useEffect(() => {
    if (invQ.data) setValor(String(invQ.data.inventario_final ?? ''));
  }, [invQ.data]);

  const invMut = useMutation({
    mutationFn: () => api.put('/contabilidad/inventario-periodo', {
      anio, mes, inventario_final: Number(String(valor).replace(',', '.')) || 0,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contab-invper', anio, mes] });
      toast.success('Inventario final guardado');
      onSaved?.();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo guardar'),
  });

  const mesTxt = MESES[mes - 1] || `mes ${mes}`;

  return (
    <div className="card mb-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2 text-gray-700 pb-1">
          <Package size={18} className="text-brand-500" />
          <span className="font-medium text-sm">Costeo de inventario · ejercicio {anio}</span>
        </div>
        <div>
          <label className="label">Método</label>
          <select className="input w-[26rem] max-w-full" value={metodo} disabled={!isAdmin || metodoMut.isPending}
            onChange={(e) => metodoMut.mutate(e.target.value)}>
            {METODOS_INV.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {esPeriodico && (
          <>
            <div>
              <label className="label">
                Inventario final · {mesTxt}
                {mes === 13 && <span className="text-gray-400"> (conteo físico del ejercicio)</span>}
              </label>
              <input className="input w-40 text-right tabular-nums" inputMode="decimal"
                value={valor} disabled={!isAdmin} onChange={(e) => setValor(e.target.value)} />
            </div>
            <button onClick={() => invMut.mutate()} disabled={!isAdmin || invMut.isPending} className="btn-primary">
              {invMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              Guardar
            </button>
            {invQ.data && (
              <div className="text-xs text-gray-500 pb-1">
                {invQ.data.sugerido
                  ? <>Sugerido del kardex: <b>${money(invQ.data.kardex)}</b> — sin capturar</>
                  : <>Capturado · el kardex sugiere ${money(invQ.data.kardex)}</>}
                {' · '}
                <button type="button" className="text-brand-600 hover:underline"
                  onClick={() => setValor(String(invQ.data.kardex ?? ''))}>usar kardex</button>
              </div>
            )}
          </>
        )}
        {!esPeriodico && (
          <p className="text-xs text-gray-400 pb-1 max-w-md">
            {metodo === 'perpetuo'
              ? 'El costo de venta sale de las salidas del kardex al generar el periodo.'
              : 'El costo de venta del periodo se toma como las compras netas de mercancía (uso G01) del mes.'}
          </p>
        )}
      </div>
      {!isAdmin && (
        <p className="text-xs text-gray-400 mt-2">Solo un administrador puede cambiar el método o el inventario final.</p>
      )}
    </div>
  );
}

// ── Editor de póliza (alta manual / edición) ──────────────────────────────────
function PolizaEditor({ poliza, anio, mes, onClose, onSaved }) {
  const esNueva = !poliza;
  const mm = String(mes).padStart(2, '0');
  const [tipo, setTipo] = useState(poliza?.tipo || 'diario');
  const [fecha, setFecha] = useState(poliza ? String(poliza.fecha).slice(0, 10) : `${anio}-${mm}-01`);
  const [concepto, setConcepto] = useState(poliza?.concepto || '');
  const [movs, setMovs] = useState(
    poliza?.movimientos?.length
      ? poliza.movimientos.map((m) => ({
          cuenta_codigo: m.cuenta_codigo, cargo: Number(m.cargo) || 0,
          abono: Number(m.abono) || 0, concepto: m.concepto || '',
        }))
      : [{ cuenta_codigo: '', cargo: 0, abono: 0, concepto: '' },
         { cuenta_codigo: '', cargo: 0, abono: 0, concepto: '' }]);

  const setMov = (i, campo, valor) => setMovs((a) => a.map((m, j) => (j === i ? { ...m, [campo]: valor } : m)));
  const addMov = () => setMovs((a) => [...a, { cuenta_codigo: '', cargo: 0, abono: 0, concepto: '' }]);
  const delMov = (i) => setMovs((a) => a.filter((_, j) => j !== i));

  const totCargos = r2(movs.reduce((s, m) => s + (Number(m.cargo) || 0), 0));
  const totAbonos = r2(movs.reduce((s, m) => s + (Number(m.abono) || 0), 0));
  const cuadra = Math.abs(totCargos - totAbonos) < 0.01 && totCargos > 0;

  const guardar = useMutation({
    mutationFn: () => {
      const payload = {
        tipo, fecha, concepto,
        movimientos: movs
          .filter((m) => m.cuenta_codigo && (Number(m.cargo) || Number(m.abono)))
          .map((m) => ({ cuenta_codigo: m.cuenta_codigo, cargo: Number(m.cargo) || 0,
                         abono: Number(m.abono) || 0, concepto: m.concepto || null })),
      };
      return esNueva
        ? api.post('/contabilidad/polizas', payload)
        : api.put(`/contabilidad/polizas/${poliza.id}`, payload);
    },
    onSuccess: () => { toast.success(esNueva ? 'Póliza creada' : 'Póliza actualizada'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  const { confirmar, dialogoConfirm } = useConfirm();

  const cambiarEstado = useMutation({
    mutationFn: (estado) => api.put(`/contabilidad/polizas/${poliza.id}`, { estado }),
    onSuccess: (_, estado) => { toast.success(estado === 'confirmada' ? 'Confirmada' : 'Reabierta'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });
  const eliminar = useMutation({
    mutationFn: () => api.delete(`/contabilidad/polizas/${poliza.id}`),
    onSuccess: () => { toast.success('Póliza eliminada'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-gray-900">
            {esNueva ? 'Nueva póliza manual' : `Editar póliza #${poliza.id}`}
            {poliza?.estado && (
              <span className={`ml-2 text-xs ${poliza.estado === 'confirmada' ? 'text-green-600' : 'text-gray-400'}`}>
                · {poliza.estado}
              </span>
            )}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Fecha</label>
              <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="diario">Diario</option>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
            </div>
            <div>
              <label className="label">Concepto</label>
              <input className="input" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Movimientos</label>
              <button onClick={addMov} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                <Plus size={13} /> Agregar renglón
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="text-left">Cuenta</th>
                  <th className="text-right w-32">Cargo</th>
                  <th className="text-right w-32">Abono</th>
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
            <div className="mt-2"><Cuadre cuadra={cuadra} cargos={totCargos} abonos={totAbonos} /></div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <button onClick={() => guardar.mutate()} disabled={!cuadra || guardar.isPending} className="btn-primary">
            {guardar.isPending && <Loader2 size={15} className="animate-spin" />}
            {esNueva ? 'Crear póliza' : 'Guardar cambios'}
          </button>
          {!esNueva && poliza.estado === 'borrador' && (
            <button onClick={() => cambiarEstado.mutate('confirmada')} disabled={cambiarEstado.isPending}
              className="btn-secondary text-green-700"><ShieldCheck size={15} /> Confirmar</button>
          )}
          {!esNueva && poliza.estado === 'confirmada' && (
            <button onClick={() => cambiarEstado.mutate('borrador')} disabled={cambiarEstado.isPending}
              className="btn-secondary"><Undo2 size={15} /> Reabrir</button>
          )}
          <div className="ml-auto flex gap-3">
            {!esNueva && (
              <button
                onClick={async () => {
                  if (await confirmar('¿Eliminar esta póliza?', { titulo: 'Eliminar póliza', textoConfirmar: 'Eliminar' })) {
                    eliminar.mutate();
                  }
                }}
                disabled={eliminar.isPending} className="btn-secondary text-red-600"><Trash2 size={15} /> Eliminar</button>
            )}
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
          </div>
        </div>
      </div>
      {dialogoConfirm}
    </div>
  );
}
