import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, FileText, Truck, PackageCheck, Download, Stamp, Ban } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const OC_BADGE = { abierta: 'badge-blue', parcial: 'badge-yellow', recibida: 'badge-green', cancelada: 'badge-red' };
const CFDI_BADGE = { pendiente: 'badge-gray', generado: 'badge-blue', timbrado: 'badge-green', cancelado: 'badge-red' };

// Catálogos SAT (mínimos; ampliar cuando llegue la spec del PAC)
const FORMAS_PAGO = [['01', '01 · Efectivo'], ['02', '02 · Cheque nominativo'], ['03', '03 · Transferencia'], ['04', '04 · Tarjeta de crédito'], ['28', '28 · Tarjeta de débito'], ['99', '99 · Por definir']];
const METODOS_PAGO = [['PUE', 'PUE · Pago en una exhibición'], ['PPD', 'PPD · Pago en parcialidades o diferido']];
const USOS_CFDI = [['G01', 'G01 · Adquisición de mercancías'], ['G03', 'G03 · Gastos en general'], ['I01', 'I01 · Construcciones'], ['P01', 'P01 · Por definir'], ['CP01', 'CP01 · Pagos']];

// ── Modal de recepción (parcial) ──────────────────────────────────────────────
function RecepcionModal({ ocId, onClose, onDone }) {
  const [almacen, setAlmacen] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [lineas, setLineas] = useState({});   // ocpId -> { cantidad, numero_lote, fecha_caducidad }

  const { data: oc } = useQuery({ queryKey: ['oc', ocId], queryFn: () => api.get(`/ventas/ordenes-compra/${ocId}`).then((r) => r.data) });
  const { data: almacenes = [] } = useQuery({ queryKey: ['almacenes'], queryFn: () => api.get('/almacenes').then((r) => r.data) });
  const { data: ubicaciones = [] } = useQuery({ queryKey: ['ubicaciones', almacen], enabled: !!almacen, queryFn: () => api.get(`/almacenes/${almacen}/ubicaciones`).then((r) => r.data) });

  const mut = useMutation({
    mutationFn: (body) => api.post(`/ventas/ordenes-compra/${ocId}/recepciones`, body),
    onSuccess: (res) => { toast.success(`Recepción ${res.data.folio} registrada`); onDone(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  function submit() {
    if (!almacen || !ubicacion) return toast.error('Selecciona almacén y ubicación');
    const partidas = (oc?.partidas || [])
      .filter((p) => Number(lineas[p.id]?.cantidad) > 0)
      .map((p) => ({ oc_partida_id: p.id, cantidad: Number(lineas[p.id].cantidad),
        numero_lote: lineas[p.id].numero_lote || null, fecha_caducidad: lineas[p.id].fecha_caducidad || null,
        ubicacion_id: Number(ubicacion), costo_unitario: p.precio_compra }));
    if (!partidas.length) return toast.error('Captura al menos una cantidad recibida');
    mut.mutate({ almacen_id: Number(almacen), partidas });
  }

  return (
    <Modal size="lg" title={`Recepción de ${oc?.folio || 'OC'}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Almacén *</label>
            <select className="input" value={almacen} onChange={(e) => { setAlmacen(e.target.value); setUbicacion(''); }}>
              <option value="">—</option>{almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Ubicación *</label>
            <select className="input" value={ubicacion} disabled={!almacen} onChange={(e) => setUbicacion(e.target.value)}>
              <option value="">—</option>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-400">Captura lo recibido ahora (puede ser parcial). Lote y caducidad por producto.</p>
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50"><tr><th className="px-2 py-1 text-left">SKU / Desc.</th><th className="px-2 py-1 text-right">Pend.</th><th className="px-2 py-1">Recibir</th><th className="px-2 py-1">Lote</th><th className="px-2 py-1">Caducidad</th></tr></thead>
            <tbody>
              {(oc?.partidas || []).map((p) => {
                const pend = Number(p.cantidad) - Number(p.cantidad_recibida);
                const l = lineas[p.id] || {};
                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-2 py-1"><span className="font-mono text-brand-500">{p.sku_interno}</span> <span className="text-gray-500">{p.descripcion?.substring(0, 40)}</span></td>
                    <td className="px-2 py-1 text-right">{pend}</td>
                    <td className="px-2 py-1"><input type="number" min="0" max={pend} step="0.01" className="input w-20 text-xs" value={l.cantidad || ''} onChange={(e) => setLineas((x) => ({ ...x, [p.id]: { ...l, cantidad: e.target.value } }))} /></td>
                    <td className="px-2 py-1"><input className="input w-24 text-xs font-mono" value={l.numero_lote || ''} onChange={(e) => setLineas((x) => ({ ...x, [p.id]: { ...l, numero_lote: e.target.value } }))} placeholder="opcional" /></td>
                    <td className="px-2 py-1"><input type="date" className="input w-32 text-xs" value={l.fecha_caducidad || ''} onChange={(e) => setLineas((x) => ({ ...x, [p.id]: { ...l, fecha_caducidad: e.target.value } }))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={submit} disabled={mut.isPending} className="btn-primary">{mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <PackageCheck size={15} />} Registrar recepción</button>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal de entrega (remisión / factura) ─────────────────────────────────────
function EntregaModal({ pedido, onClose, onDone }) {
  const [tipo, setTipo] = useState('remision');
  const [lineas, setLineas] = useState({});
  const [cfdi, setCfdi] = useState({ forma_pago: '03', metodo_pago: 'PUE', uso_cfdi: 'G03' });
  const [faltantes, setFaltantes] = useState([]);

  const mut = useMutation({
    mutationFn: (body) => api.post(`/ventas/pedidos/${pedido.id}/entregas`, body),
    onSuccess: (res) => {
      toast.success(`${res.data.tipo === 'factura' ? 'Factura' : 'Remisión'} ${res.data.folio} generada`);
      if (res.data.url) window.open(res.data.url, '_blank');
      if (res.data.cfdi_txt) window.open(res.data.cfdi_txt, '_blank');
      onDone();
    },
    onError: (e) => {
      const d = e.response?.data;
      if (e.response?.status === 422 && Array.isArray(d?.faltantes)) { setFaltantes(d.faltantes); toast.error(d.error || 'Faltan datos fiscales'); }
      else toast.error(d?.error || 'Error');
    },
  });

  function submit() {
    setFaltantes([]);
    const partidas = (pedido.partidas || [])
      .filter((p) => Number(lineas[p.id]) > 0)
      .map((p) => ({ pedido_partida_id: p.id, cantidad: Number(lineas[p.id]) }));
    if (!partidas.length) return toast.error('Captura cantidades a entregar');
    mut.mutate({ tipo, partidas, ...(tipo === 'factura' ? cfdi : {}) });
  }

  return (
    <Modal size="lg" title="Generar entrega al cliente" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          {['remision', 'factura'].map((t) => (
            <button key={t} onClick={() => { setTipo(t); setFaltantes([]); }} className={`px-4 py-2 rounded-lg text-sm font-medium border ${tipo === t ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-gray-200 text-gray-600'}`}>{t === 'remision' ? 'Remisión' : 'Factura'}</button>
          ))}
        </div>
        {tipo === 'factura' && (
          <div className="grid grid-cols-3 gap-3 bg-gray-50 rounded-lg p-3">
            <div>
              <label className="label">Forma de pago</label>
              <select className="input text-sm" value={cfdi.forma_pago} onChange={(e) => setCfdi((c) => ({ ...c, forma_pago: e.target.value }))}>
                {FORMAS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Método de pago</label>
              <select className="input text-sm" value={cfdi.metodo_pago} onChange={(e) => setCfdi((c) => ({ ...c, metodo_pago: e.target.value }))}>
                {METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Uso de CFDI</label>
              <select className="input text-sm" value={cfdi.uso_cfdi} onChange={(e) => setCfdi((c) => ({ ...c, uso_cfdi: e.target.value }))}>
                {USOS_CFDI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        )}
        {faltantes.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm font-medium text-red-700 mb-1">Faltan datos para emitir la factura (CFDI 4.0):</p>
            <ul className="text-xs text-red-600 list-disc pl-5 space-y-0.5">{faltantes.map((f, i) => <li key={i}>{f}</li>)}</ul>
            <p className="text-xs text-red-500 mt-2">Captura los datos del cliente o del producto y vuelve a intentar.</p>
          </div>
        )}
        <p className="text-xs text-gray-400">Solo puedes entregar lo recibido y disponible en inventario. Se descuenta por FEFO (caduca primero).</p>
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50"><tr><th className="px-2 py-1 text-left">SKU / Desc.</th><th className="px-2 py-1 text-right">Recibido</th><th className="px-2 py-1 text-right">Entregado</th><th className="px-2 py-1 text-right">Stock</th><th className="px-2 py-1">Entregar</th></tr></thead>
            <tbody>
              {(pedido.partidas || []).map((p) => {
                const pend = Number(p.cantidad_recibida) - Number(p.cantidad_entregada);
                const max = Math.min(pend, Number(p.stock));
                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-2 py-1"><span className="font-mono text-brand-500">{p.sku_interno}</span> <span className="text-gray-500">{p.descripcion?.substring(0, 38)}</span></td>
                    <td className="px-2 py-1 text-right">{Number(p.cantidad_recibida)}</td>
                    <td className="px-2 py-1 text-right">{Number(p.cantidad_entregada)}</td>
                    <td className="px-2 py-1 text-right">{Number(p.stock)}</td>
                    <td className="px-2 py-1"><input type="number" min="0" max={max} step="0.01" className="input w-20 text-xs" value={lineas[p.id] || ''} disabled={max <= 0} onChange={(e) => setLineas((x) => ({ ...x, [p.id]: e.target.value }))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={submit} disabled={mut.isPending} className="btn-primary">{mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />} Generar {tipo === 'factura' ? 'factura' : 'remisión'}</button>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}

export default function DetallePedido() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const [recOC, setRecOC] = useState(null);
  const [showEntrega, setShowEntrega] = useState(false);
  const [timbrando, setTimbrando] = useState(null);

  const { data: ped, isLoading } = useQuery({
    queryKey: ['pedido', id], queryFn: () => api.get(`/ventas/pedidos/${id}`).then((r) => r.data),
  });

  const genOC = useMutation({
    mutationFn: () => api.post(`/ventas/pedidos/${id}/ordenes-compra`),
    onSuccess: (res) => { toast.success(`${res.data.ordenes} orden(es) de compra generada(s)`); refrescar(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  function refrescar() { qc.invalidateQueries(['pedido', id]); setRecOC(null); setShowEntrega(false); }
  async function abrirPdf(url) { if (url) window.open(url, '_blank'); }
  async function pdfOC(ocId) { const { data } = await api.get(`/ventas/ordenes-compra/${ocId}/pdf`); abrirPdf(data.url); }
  async function descargarTxt(entId) {
    try { const { data } = await api.post(`/ventas/entregas/${entId}/cfdi-txt`); abrirPdf(data.url); refrescar(); }
    catch (e) {
      const d = e.response?.data;
      if (e.response?.status === 422 && Array.isArray(d?.faltantes)) toast.error(`Faltan datos: ${d.faltantes.slice(0, 3).join('; ')}${d.faltantes.length > 3 ? '…' : ''}`);
      else toast.error(d?.error || 'Error al generar TXT');
    }
  }
  // Timbra la factura ante el PAC (Facturama). Abre el PDF timbrado al terminar.
  async function timbrar(entId) {
    setTimbrando(entId);
    try {
      const { data } = await api.post(`/ventas/entregas/${entId}/cfdi/timbrar`);
      toast.success(`Timbrado · UUID ${data.uuid}`);
      if (data.pdf_url) abrirPdf(data.pdf_url);
      refrescar();
    } catch (e) {
      const d = e.response?.data;
      if (e.response?.status === 422 && Array.isArray(d?.faltantes) && d.faltantes.length)
        toast.error(`Faltan datos: ${d.faltantes.slice(0, 3).join('; ')}${d.faltantes.length > 3 ? '…' : ''}`);
      else toast.error(d?.error || 'Error al timbrar el CFDI');
    } finally { setTimbrando(null); }
  }
  // Descarga el PDF/XML del CFDI ya timbrado.
  async function descargarCfdi(entId, formato) {
    try {
      const { data } = await api.get(`/ventas/entregas/${entId}/cfdi`);
      const url = formato === 'xml' ? data.xml_path : data.pdf_path;
      if (url) abrirPdf(url); else toast.error(`Sin ${formato.toUpperCase()} disponible`);
    } catch (e) { toast.error(e.response?.data?.error || 'No se encontró el CFDI'); }
  }
  // Cancela el CFDI vigente (motivo 02 · comprobante emitido con errores sin relación).
  async function cancelarCfdi(entId) {
    const ok = await confirmar(
      '¿Cancelar el CFDI ante el SAT? (motivo 02: emitido con errores sin relación)',
      { titulo: 'Cancelar CFDI', textoConfirmar: 'Cancelar CFDI' }
    );
    if (!ok) return;
    try {
      await api.post(`/ventas/entregas/${entId}/cfdi/cancelar`, { motivo: '02' });
      toast.success('CFDI cancelado');
      refrescar();
    } catch (e) { toast.error(e.response?.data?.error || 'Error al cancelar el CFDI'); }
  }

  if (isLoading) return <p className="text-gray-400 text-center py-10">Cargando…</p>;
  if (!ped) return <p className="text-gray-400 text-center py-10">Pedido no encontrado</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-700"><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{ped.folio}</h1>
          <p className="text-sm text-gray-500">{ped.cliente} · Cotización <Link to={`/cotizaciones/${ped.cotizacion_id}`} className="text-brand-500">{ped.cotizacion_folio}</Link></p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => genOC.mutate()} disabled={genOC.isPending} className="btn-secondary">
            {genOC.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Generar órdenes de compra
          </button>
          <button onClick={() => setShowEntrega(true)} className="btn-primary"><Truck size={15} /> Generar entrega</button>
        </div>
      </div>

      {/* Avance de partidas */}
      <div className="card overflow-x-auto">
        <h2 className="font-semibold text-gray-800 mb-3">Partidas del pedido</h2>
        <table className="table-auto w-full text-sm">
          <thead><tr><th>SKU</th><th>Descripción</th><th>Proveedor</th><th className="text-right">Asignado</th><th className="text-right">Recibido</th><th className="text-right">Entregado</th><th className="text-right">Stock</th></tr></thead>
          <tbody>
            {ped.partidas?.map((p) => (
              <tr key={p.id}>
                <td className="font-mono text-xs text-brand-500">{p.sku_interno}</td>
                <td className="max-w-xs truncate">{p.descripcion}</td>
                <td className="text-xs">{p.proveedor || <span className="text-amber-500">sin proveedor</span>}</td>
                <td className="text-right">{Number(p.cantidad_asignada)}</td>
                <td className="text-right">{Number(p.cantidad_recibida)}</td>
                <td className="text-right">{Number(p.cantidad_entregada)}</td>
                <td className="text-right">{Number(p.stock)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Órdenes de compra */}
      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-3">Órdenes de compra</h2>
        {(!ped.ordenes_compra || ped.ordenes_compra.length === 0) ? (
          <p className="text-sm text-gray-400">Aún no se generan. Usa «Generar órdenes de compra».</p>
        ) : (
          <table className="table-auto w-full text-sm">
            <thead><tr><th>Folio</th><th>Proveedor</th><th className="text-right">Total</th><th className="text-center">Estatus</th><th></th></tr></thead>
            <tbody>
              {ped.ordenes_compra.map((oc) => (
                <tr key={oc.id}>
                  <td className="font-mono text-brand-500">{oc.folio}</td>
                  <td>{oc.proveedor}</td>
                  <td className="text-right">{fmt(oc.total)}</td>
                  <td className="text-center"><span className={OC_BADGE[oc.estatus] || 'badge-gray'}>{oc.estatus}</span></td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => pdfOC(oc.id)} className="text-xs text-gray-500 hover:text-brand-500 mr-3"><Download size={14} className="inline" /> PDF</button>
                    {oc.estatus !== 'recibida' && oc.estatus !== 'cancelada' && (
                      <button onClick={() => setRecOC(oc.id)} className="text-xs text-brand-500 hover:underline"><PackageCheck size={14} className="inline" /> Recepción</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Entregas */}
      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-3">Entregas (remisiones / facturas)</h2>
        {(!ped.entregas || ped.entregas.length === 0) ? (
          <p className="text-sm text-gray-400">Sin entregas todavía.</p>
        ) : (
          <table className="table-auto w-full text-sm">
            <thead><tr><th>Folio</th><th>Tipo</th><th className="text-right">Total</th><th className="text-center">CFDI</th><th>Fecha</th><th></th></tr></thead>
            <tbody>
              {ped.entregas.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-brand-500">{e.folio}</td>
                  <td className="capitalize">{e.tipo}</td>
                  <td className="text-right">{fmt(e.total)}</td>
                  <td className="text-center">{e.tipo === 'factura' ? <span className={CFDI_BADGE[e.estatus_cfdi] || 'badge-gray'}>{e.estatus_cfdi || 'pendiente'}</span> : <span className="text-gray-300">—</span>}</td>
                  <td>{new Date(e.created_at).toLocaleDateString('es-MX')}</td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={async () => { const { data } = await api.get(`/ventas/entregas/${e.id}/pdf`); abrirPdf(data.url); }} className="text-xs text-gray-500 hover:text-brand-500 mr-3"><Download size={14} className="inline" /> PDF</button>
                    {e.tipo === 'factura' && e.estatus_cfdi !== 'timbrado' && e.estatus_cfdi !== 'cancelado' && (
                      <button onClick={() => timbrar(e.id)} disabled={timbrando === e.id} className="text-xs text-emerald-600 hover:underline mr-3">
                        {timbrando === e.id ? <Loader2 size={14} className="inline animate-spin" /> : <Stamp size={14} className="inline" />} Timbrar
                      </button>
                    )}
                    {e.tipo === 'factura' && e.estatus_cfdi === 'timbrado' && (
                      <>
                        <button onClick={() => descargarCfdi(e.id, 'pdf')} className="text-xs text-brand-500 hover:underline mr-3"><Download size={14} className="inline" /> PDF CFDI</button>
                        <button onClick={() => descargarCfdi(e.id, 'xml')} className="text-xs text-gray-500 hover:text-brand-500 mr-3"><FileText size={14} className="inline" /> XML</button>
                        <button onClick={() => cancelarCfdi(e.id)} className="text-xs text-red-500 hover:underline"><Ban size={14} className="inline" /> Cancelar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {recOC && <RecepcionModal ocId={recOC} onClose={() => setRecOC(null)} onDone={refrescar} />}
      {showEntrega && <EntregaModal pedido={ped} onClose={() => setShowEntrega(false)} onDone={refrescar} />}

      {dialogoConfirm}
    </div>
  );
}
