import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Receipt, Stamp, Trash2, Download } from 'lucide-react';
import api from '../../services/api';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const FORMAS_PAGO = [['01', '01 · Efectivo'], ['02', '02 · Cheque nominativo'], ['03', '03 · Transferencia'], ['04', '04 · Tarjeta de crédito'], ['28', '28 · Tarjeta de débito'], ['99', '99 · Por definir']];
const METODOS_PAGO = [['PUE', 'PUE · Pago en una exhibición'], ['PPD', 'PPD · Pago en parcialidades o diferido']];
const USOS_CFDI = [['G01', 'G01 · Adquisición de mercancías'], ['G03', 'G03 · Gastos en general'], ['I01', 'I01 · Construcciones'], ['P01', 'P01 · Por definir'], ['CP01', 'CP01 · Pagos']];

export default function FacturarRemisiones() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const [clienteId, setClienteId] = useState('');
  const [sel, setSel] = useState([]);
  const [cfdi, setCfdi] = useState({ forma_pago: '', metodo_pago: '', uso_cfdi: '' });
  const [notas, setNotas] = useState('');
  const [faltantes, setFaltantes] = useState([]);
  const [timbrando, setTimbrando] = useState(null);

  const { data: remisiones = [], isLoading } = useQuery({
    queryKey: ['remisiones-pendientes'], queryFn: () => api.get('/ventas/remisiones/pendientes').then((r) => r.data),
  });
  const { data: pendientes = [] } = useQuery({
    queryKey: ['facturas-consolidadas'], queryFn: () => api.get('/ventas/remisiones/facturas').then((r) => r.data),
  });

  const clientes = useMemo(() => {
    const m = new Map();
    remisiones.forEach((r) => m.set(r.cliente_id, r.cliente));
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre }));
  }, [remisiones]);
  const visibles = remisiones.filter((r) => String(r.cliente_id) === String(clienteId));

  // Resumen calculado por el servidor (suma exacta de las partidas de las remisiones elegidas).
  const { data: resumen, isFetching: cargandoResumen } = useQuery({
    queryKey: ['resumen-consolidar', [...sel].sort().join(','), cfdi],
    enabled: sel.length > 0,
    queryFn: () => api.post('/ventas/remisiones/consolidar/resumen', { remision_ids: sel, ...cfdi }).then((r) => r.data),
  });

  // Precarga forma/método/uso del cliente la primera vez que llega el resumen.
  useEffect(() => {
    if (!resumen) return;
    setCfdi((c) => (c.forma_pago ? c : {
      forma_pago: resumen.cliente.forma_pago || '03',
      metodo_pago: resumen.cliente.metodo_pago || 'PUE',
      uso_cfdi: resumen.cliente.uso_cfdi || 'G03',
    }));
  }, [resumen]);

  function cambiarCliente(id) { setClienteId(id); setSel([]); setFaltantes([]); setCfdi({ forma_pago: '', metodo_pago: '', uso_cfdi: '' }); }
  function toggle(id) { setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); setFaltantes([]); }
  function todas() { setSel(sel.length === visibles.length ? [] : visibles.map((r) => r.id)); }
  function refrescar() { qc.invalidateQueries({ queryKey: ['remisiones-pendientes'] }); qc.invalidateQueries({ queryKey: ['facturas-consolidadas'] }); }

  const mut = useMutation({
    mutationFn: () => api.post('/ventas/remisiones/consolidar', { remision_ids: sel, ...cfdi, notas: notas.trim() || undefined }),
    onSuccess: (res) => {
      toast.success(`Factura ${res.data.folio} generada (${fmt(res.data.total)}). Revísala y timbra.`);
      if (res.data.url) window.open(res.data.url, '_blank');
      setSel([]); setNotas(''); setFaltantes([]); refrescar();
    },
    onError: (e) => {
      const d = e.response?.data;
      if (e.response?.status === 422 && Array.isArray(d?.faltantes)) { setFaltantes(d.faltantes); toast.error(d.error); }
      else toast.error(d?.error || 'Error al generar la factura');
    },
  });

  async function timbrar(f) {
    const ok = await confirmar(`¿Timbrar la factura ${f.folio} por ${fmt(f.total)} ante el SAT? Esta acción es fiscal.`, { titulo: 'Timbrar CFDI', textoConfirmar: 'Timbrar' });
    if (!ok) return;
    setTimbrando(f.id);
    try {
      const { data } = await api.post(`/ventas/entregas/${f.id}/cfdi/timbrar`);
      toast.success(`Timbrado · UUID ${data.uuid}`);
      if (data.pdf_url) window.open(data.pdf_url, '_blank');
      refrescar();
    } catch (e) {
      const d = e.response?.data;
      if (e.response?.status === 422 && Array.isArray(d?.faltantes) && d.faltantes.length) toast.error(`Faltan datos: ${d.faltantes.slice(0, 3).join('; ')}`);
      else toast.error(d?.error || 'Error al timbrar el CFDI');
    } finally { setTimbrando(null); }
  }
  async function descartar(f) {
    const ok = await confirmar(`¿Descartar la factura ${f.folio}? Las remisiones quedarán libres para facturarse de nuevo.`, { titulo: 'Descartar factura', textoConfirmar: 'Descartar' });
    if (!ok) return;
    try { await api.delete(`/ventas/remisiones/facturas/${f.id}`); toast.success('Factura descartada'); refrescar(); }
    catch (e) { toast.error(e.response?.data?.error || 'Error'); }
  }
  async function pdf(f) { const { data } = await api.get(`/ventas/entregas/${f.id}/pdf`); if (data.url) window.open(data.url, '_blank'); }

  return (
    <div className="space-y-5">
      {dialogoConfirm}
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Receipt size={22} /> Facturar remisiones</h1>
      <p className="text-sm text-gray-500">Selecciona una o varias remisiones del mismo cliente (aunque sean de distintas sucursales o pedidos). La factura es la suma exacta de las remisiones; no se modifican.</p>

      {pendientes.length > 0 && (
        <div className="card p-4">
          <h2 className="font-semibold text-gray-800 mb-2">Facturas generadas pendientes de timbrar</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500"><th>Folio</th><th>Cliente</th><th>Remisiones</th><th className="text-right">Total</th><th></th></tr></thead>
            <tbody>
              {pendientes.map((f) => (
                <tr key={f.id} className="border-t">
                  <td className="py-1.5 font-medium">{f.folio}</td><td>{f.cliente}</td><td className="text-xs text-gray-500">{f.remisiones}</td>
                  <td className="text-right">{fmt(f.total)}</td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => pdf(f)} className="text-xs text-gray-500 hover:text-brand-500 mr-3"><Download size={14} className="inline" /> PDF</button>
                    <button disabled={timbrando === f.id} onClick={() => timbrar(f)} className="text-xs text-brand-500 font-medium mr-3"><Stamp size={14} className="inline" /> {timbrando === f.id ? 'Timbrando…' : 'Timbrar'}</button>
                    <button onClick={() => descartar(f)} className="text-xs text-red-500"><Trash2 size={14} className="inline" /> Descartar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="label mb-0">Cliente</label>
          <select className="input w-80" value={clienteId} onChange={(e) => cambiarCliente(e.target.value)}>
            <option value="">— Selecciona cliente con remisiones por facturar —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        {isLoading && <p className="text-gray-400 text-sm">Cargando…</p>}
        {!isLoading && !remisiones.length && <p className="text-sm text-gray-400">No hay remisiones pendientes de facturar.</p>}
        {clienteId && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr className="text-left text-xs text-gray-500">
              <th className="px-2 py-1 w-8"><input type="checkbox" checked={visibles.length > 0 && sel.length === visibles.length} onChange={todas} /></th>
              <th>Remisión</th><th>Fecha</th><th>Sucursal</th><th>Pedido</th><th className="text-right">Partidas</th><th className="text-right pr-2">Total</th>
            </tr></thead>
            <tbody>
              {visibles.map((r) => (
                <tr key={r.id} className={`border-t cursor-pointer ${sel.includes(r.id) ? 'bg-brand-50' : ''}`} onClick={() => toggle(r.id)}>
                  <td className="px-2 py-1.5"><input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td className="font-medium">{r.folio}</td>
                  <td>{new Date(r.created_at).toLocaleDateString('es-MX')}</td>
                  <td>{r.sucursal || '—'}</td><td>{r.pedido_folio || '—'}</td>
                  <td className="text-right">{r.partidas}</td><td className="text-right pr-2">{fmt(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sel.length > 0 && (
        <div className="card p-4 space-y-4">
          <h2 className="font-semibold text-gray-800">Resumen de la factura ({sel.length} {sel.length > 1 ? 'remisiones' : 'remisión'})</h2>
          {resumen ? (
            <>
              <div className="overflow-x-auto max-h-64 border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0"><tr className="text-left"><th className="px-2 py-1">Remisión</th><th>SKU</th><th>Descripción</th><th className="text-right">Cant.</th><th className="text-right">P. unit.</th><th className="text-right pr-2">Importe</th></tr></thead>
                  <tbody>
                    {resumen.partidas.map((p, i) => (
                      <tr key={i} className="border-t"><td className="px-2 py-1">{p.remision_folio}</td><td>{p.sku_interno}</td><td>{p.descripcion}</td>
                        <td className="text-right">{p.cantidad}</td><td className="text-right">{fmt(p.precio_unitario)}</td><td className="text-right pr-2">{fmt(p.cantidad * p.precio_unitario)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <dl className="text-sm w-72 space-y-1">
                  <div className="flex justify-between"><dt className="text-gray-500">Subtotal</dt><dd>{fmt(resumen.subtotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">IVA</dt><dd>{fmt(resumen.iva)}</dd></div>
                  <div className="flex justify-between font-bold text-base border-t pt-1"><dt>Total factura</dt><dd>{fmt(resumen.total)}</dd></div>
                  <div className="flex justify-between text-xs text-gray-400"><dt>Suma de remisiones</dt><dd>{fmt(resumen.suma_remisiones)}</dd></div>
                  {Math.abs(resumen.diferencia_redondeo) > 0.001 && <p className="text-xs text-amber-600">Diferencia por redondeo de IVA por concepto: {fmt(resumen.diferencia_redondeo)}</p>}
                </dl>
              </div>

              <div className="grid grid-cols-3 gap-3 bg-gray-50 rounded-lg p-3">
                <div><label className="label">Forma de pago</label>
                  <select className="input text-sm" value={cfdi.forma_pago} onChange={(e) => setCfdi((c) => ({ ...c, forma_pago: e.target.value }))}>{FORMAS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div><label className="label">Método de pago</label>
                  <select className="input text-sm" value={cfdi.metodo_pago} onChange={(e) => setCfdi((c) => ({ ...c, metodo_pago: e.target.value }))}>{METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div><label className="label">Uso de CFDI</label>
                  <select className="input text-sm" value={cfdi.uso_cfdi} onChange={(e) => setCfdi((c) => ({ ...c, uso_cfdi: e.target.value }))}>{USOS_CFDI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              </div>
              <div>
                <label className="label">Observaciones (solo en el PDF)</label>
                <textarea className="input text-sm" rows={2} maxLength={300} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. No. de proveedor, contrato u orden de compra del cliente" />
              </div>
              {(faltantes.length > 0 || resumen.faltantes.length > 0) && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-red-700 mb-1">Faltan datos para emitir la factura (CFDI 4.0):</p>
                  <ul className="list-disc pl-5 text-xs text-red-600">{(faltantes.length ? faltantes : resumen.faltantes).map((f, i) => <li key={i}>{f}</li>)}</ul>
                </div>
              )}
              <div className="flex justify-end">
                <button className="btn-primary" disabled={mut.isPending || cargandoResumen || !cfdi.forma_pago} onClick={() => mut.mutate()}>
                  <Receipt size={15} /> {mut.isPending ? 'Generando…' : `Generar factura por ${fmt(resumen.total)}`}
                </button>
              </div>
            </>
          ) : <p className="text-sm text-gray-400">Calculando…</p>}
        </div>
      )}
    </div>
  );
}
