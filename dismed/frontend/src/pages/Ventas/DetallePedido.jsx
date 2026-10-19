import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, FileText, Truck, PackageCheck, Download, Stamp, Ban, Link2 } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import ProductoPicker from '../../components/shared/ProductoPicker';

const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const OC_BADGE = { abierta: 'badge-blue', parcial: 'badge-yellow', recibida: 'badge-green', cancelada: 'badge-red' };
const ENT_BADGE = { pendiente: 'badge-yellow', confirmada: 'badge-green', cancelada: 'badge-red' };
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
  const [vinculos, setVinculos] = useState({}); // ocpId -> producto (partida sin producto_id, vinculada aquí)
  const [picker, setPicker] = useState(null);   // partida que se está vinculando

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
    const noEntero = Object.values(lineas).some((l) => l?.cantidad !== undefined && l.cantidad !== '' && !Number.isInteger(Number(l.cantidad)));
    if (noEntero) return toast.error('La cantidad recibida debe ser un número entero');
    const aRecibir = (oc?.partidas || []).filter((p) => Number(lineas[p.id]?.cantidad) > 0);
    const sinVincular = aRecibir.filter((p) => !p.producto_id && !vinculos[p.id]);
    if (sinVincular.length) return toast.error(`Vincula un producto del catálogo para ${sinVincular.length} partida(s) antes de recibir`);
    const partidas = aRecibir.map((p) => ({ oc_partida_id: p.id, cantidad: Number(lineas[p.id].cantidad),
      numero_lote: lineas[p.id].numero_lote || null, fecha_caducidad: lineas[p.id].fecha_caducidad || null,
      ubicacion_id: Number(ubicacion), costo_unitario: p.precio_compra,
      producto_id: vinculos[p.id]?.id || null }));
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
                const vinculo = vinculos[p.id];
                const sinProducto = !p.producto_id && !vinculo;
                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-2 py-1">
                      {sinProducto ? (
                        <span className="text-gray-500">{p.descripcion?.substring(0, 40)}</span>
                      ) : (
                        <><span className="font-mono text-brand-500">{vinculo?.sku_interno || p.sku_interno}</span> <span className="text-gray-500">{(vinculo?.descripcion || p.descripcion)?.substring(0, 40)}</span></>
                      )}
                      {sinProducto && (
                        <button type="button" onClick={() => setPicker(p)} className="block text-[11px] text-brand-500 hover:underline mt-0.5">
                          <Link2 size={11} className="inline -mt-0.5 mr-0.5" /> Vincular a producto del catálogo
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">{pend}</td>
                    <td className="px-2 py-1"><input type="number" min="0" max={pend} step="1" className="input w-20 text-xs" value={l.cantidad || ''} disabled={sinProducto} title={sinProducto ? 'Vincula un producto del catálogo primero' : undefined} onChange={(e) => setLineas((x) => ({ ...x, [p.id]: { ...l, cantidad: e.target.value } }))} /></td>
                    <td className="px-2 py-1"><input className="input w-24 text-xs font-mono" disabled={sinProducto} value={l.numero_lote || ''} onChange={(e) => setLineas((x) => ({ ...x, [p.id]: { ...l, numero_lote: e.target.value } }))} placeholder="opcional" /></td>
                    <td className="px-2 py-1"><input type="date" className="input w-32 text-xs" disabled={sinProducto} value={l.fecha_caducidad || ''} onChange={(e) => setLineas((x) => ({ ...x, [p.id]: { ...l, fecha_caducidad: e.target.value } }))} /></td>
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

      {picker && (
        <ProductoPicker
          open={!!picker}
          onClose={() => setPicker(null)}
          incluirNoVendibles
          partida={{ descripcion_original: picker.descripcion, codigo_cliente: picker.sku_interno }}
          onSelect={(prod) => { setVinculos((v) => ({ ...v, [picker.id]: prod })); setPicker(null); }}
        />
      )}
    </Modal>
  );
}

// ── Modal de entrega (remisión / factura) ─────────────────────────────────────
function EntregaModal({ pedido, onClose, onDone }) {
  const [tipo, setTipo] = useState('remision');
  // Sugerencia automática: surtir primero lo que ya hay en almacén (sale por FEFO, caduca antes que lo recién comprado)
  const [lineas, setLineas] = useState(() => {
    const init = {};
    (pedido.partidas || []).forEach((p) => {
      const max = Number(p.sugerido_entrega) || 0;
      if (max > 0) init[p.id] = String(max);
    });
    return init;
  });
  const [cfdi, setCfdi] = useState({
    forma_pago: pedido.cliente_forma_pago || '03',
    metodo_pago: pedido.cliente_metodo_pago || 'PUE',
    uso_cfdi: pedido.cliente_uso_cfdi || 'G03',
  });
  const [faltantes, setFaltantes] = useState([]);
  const [notas, setNotas] = useState('');

  const mut = useMutation({
    mutationFn: (body) => api.post(`/ventas/pedidos/${pedido.id}/entregas`, body),
    onSuccess: (res) => {
      toast.success(`${res.data.tipo === 'factura' ? 'Factura' : 'Remisión'} ${res.data.folio} creada · imprímela y llévala al cliente; confírmala al entregar (aún no descuenta inventario)`);
      if (res.data.url) window.open(res.data.url, '_blank');
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
    const noEntero = Object.values(lineas).some((v) => v !== undefined && v !== '' && !Number.isInteger(Number(v)));
    if (noEntero) return toast.error('La cantidad a entregar debe ser un número entero');
    const partidas = (pedido.partidas || [])
      .filter((p) => Number(lineas[p.id]) > 0)
      .map((p) => ({ pedido_partida_id: p.id, cantidad: Number(lineas[p.id]) }));
    if (!partidas.length) return toast.error('Captura cantidades a entregar');
    mut.mutate({ tipo, partidas, ...(tipo === 'factura' ? { ...cfdi, notas: notas.trim() || undefined } : {}) });
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
        {tipo === 'factura' && (
          <div>
            <label className="label">Observaciones (solo en el PDF, no van en el XML)</label>
            <textarea className="input text-sm" rows={3} maxLength={300} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. No. de proveedor, no. de contrato u orden de compra del cliente" />
            <p className="text-xs text-gray-400 text-right">{notas.length}/300</p>
          </div>
        )}
        {faltantes.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm font-medium text-red-700 mb-1">Faltan datos para emitir la factura (CFDI 4.0):</p>
            <ul className="text-xs text-red-600 list-disc pl-5 space-y-0.5">{faltantes.map((f, i) => <li key={i}>{f}</li>)}</ul>
            <p className="text-xs text-red-500 mt-2">Captura los datos del cliente o del producto y vuelve a intentar.</p>
          </div>
        )}
        <p className="text-xs text-gray-400">Se sugiere surtir con la mercancía reservada para este pedido y la existencia libre en almacén; puedes ajustar las cantidades. La entrega queda PENDIENTE: el inventario se descuenta (FEFO, caduca primero) hasta que la confirmes.</p>
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50"><tr><th className="px-2 py-1 text-left">SKU / Desc.</th><th className="px-2 py-1 text-right">Pedido</th><th className="px-2 py-1 text-right">Entregado</th><th className="px-2 py-1 text-right">Reservado</th><th className="px-2 py-1 text-right">Stock libre</th><th className="px-2 py-1">Entregar</th></tr></thead>
            <tbody>
              {(pedido.partidas || []).map((p) => {
                const pend = Number(p.cantidad_asignada) - Number(p.cantidad_entregada);
                const max = Number(p.sugerido_entrega) || 0;
                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-2 py-1"><span className="font-mono text-brand-500">{p.sku_interno}</span> <span className="text-gray-500">{p.descripcion?.substring(0, 38)}</span></td>
                    <td className="px-2 py-1 text-right">{Number(p.cantidad_asignada)}</td>
                    <td className="px-2 py-1 text-right">{Number(p.cantidad_entregada)}</td>
                    <td className="px-2 py-1 text-right">{Number(p.cantidad_reservada)}</td>
                    <td className="px-2 py-1 text-right">{Number(p.stock_libre)}</td>
                    <td className="px-2 py-1"><input type="number" min="0" max={max} step="1" className="input w-20 text-xs" value={lineas[p.id] || ''} disabled={max <= 0} onChange={(e) => setLineas((x) => ({ ...x, [p.id]: e.target.value }))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={submit} disabled={mut.isPending} className="btn-primary">{mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />} Crear {tipo === 'factura' ? 'factura' : 'remisión'} (pendiente)</button>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal de órdenes de compra: lo reservado del inventario NO se pide salvo que se marque ──
function OCModal({ pedido, onClose, onDone }) {
  const reservadas = (pedido.partidas || []).filter((p) => p.proveedor_id && Number(p.cantidad_reservada) - Number(p.en_entrega_pendiente) > 0);
  const [incluir, setIncluir] = useState({});
  const mut = useMutation({
    mutationFn: (body) => api.post(`/ventas/pedidos/${pedido.id}/ordenes-compra`, body),
    onSuccess: (res) => { toast.success(`${res.data.ordenes} orden(es) de compra generada(s)`); onDone(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });
  return (
    <Modal size="lg" title="Generar órdenes de compra" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Se pedirá a proveedores únicamente lo que falta por cubrir. La mercancía que ya está <b>reservada del inventario</b> para este pedido no se solicita.</p>
        {reservadas.length > 0 && (
          <div className="border border-gray-100 rounded-lg overflow-x-auto">
            <p className="text-xs text-gray-500 px-2 py-1 bg-gray-50">Marca solo si quieres pedir también al proveedor lo reservado (se libera esa reserva en almacén):</p>
            <table className="w-full text-xs">
              <thead className="bg-gray-50"><tr><th className="px-2 py-1"></th><th className="px-2 py-1 text-left">SKU / Desc.</th><th className="px-2 py-1 text-right">Reservado</th></tr></thead>
              <tbody>
                {reservadas.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-2 py-1"><input type="checkbox" checked={!!incluir[p.id]} onChange={(e) => setIncluir((x) => ({ ...x, [p.id]: e.target.checked }))} /></td>
                    <td className="px-2 py-1"><span className="font-mono text-brand-500">{p.sku_interno}</span> <span className="text-gray-500">{p.descripcion?.substring(0, 40)}</span></td>
                    <td className="px-2 py-1 text-right">{Number(p.cantidad_reservada) - Number(p.en_entrega_pendiente)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <button onClick={() => mut.mutate({ incluir_reservado_partidas: Object.keys(incluir).filter((k) => incluir[k]).map(Number) })} disabled={mut.isPending} className="btn-primary">
            {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Generar
          </button>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal de cancelación de entrega pendiente (parcial o completa, con motivo) ──
function CancelarEntregaModal({ entrega, onClose, onDone }) {
  const [completa, setCompleta] = useState(true);
  const [lineas, setLineas] = useState({});
  const [motivo, setMotivo] = useState('');
  const mut = useMutation({
    mutationFn: (body) => api.post(`/ventas/entregas/${entrega.id}/cancelar`, body),
    onSuccess: (res) => {
      toast.success(res.data.estatus === 'cancelada' ? 'Entrega cancelada' : 'Cancelación parcial registrada · se regeneró el PDF');
      if (res.data.url) window.open(res.data.url, '_blank');
      onDone();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });
  function submit() {
    if (motivo.trim().length < 3) return toast.error('Indica el motivo de la cancelación');
    if (completa) return mut.mutate({ motivo: motivo.trim() });
    const partidas = (entrega.partidas || []).filter((l) => Number(lineas[l.id]) > 0).map((l) => ({ entrega_partida_id: l.id, cantidad: Number(lineas[l.id]) }));
    if (!partidas.length) return toast.error('Captura las cantidades a cancelar');
    mut.mutate({ motivo: motivo.trim(), partidas });
  }
  return (
    <Modal size="lg" title={`Cancelar entrega ${entrega.folio}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          {[[true, 'Entrega completa'], [false, 'Parcial (por partida)']].map(([v, l]) => (
            <button key={l} onClick={() => setCompleta(v)} className={`px-4 py-2 rounded-lg text-sm font-medium border ${completa === v ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-gray-200 text-gray-600'}`}>{l}</button>
          ))}
        </div>
        {!completa && (
          <div className="border border-gray-100 rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50"><tr><th className="px-2 py-1 text-left">SKU / Desc.</th><th className="px-2 py-1 text-right">En la entrega</th><th className="px-2 py-1">Cancelar</th></tr></thead>
              <tbody>
                {(entrega.partidas || []).map((l) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="px-2 py-1"><span className="font-mono text-brand-500">{l.sku_interno}</span> <span className="text-gray-500">{l.descripcion?.substring(0, 38)}</span></td>
                    <td className="px-2 py-1 text-right">{Number(l.cantidad)}</td>
                    <td className="px-2 py-1"><input type="number" min="0" max={Number(l.cantidad)} step="1" className="input w-20 text-xs" value={lineas[l.id] || ''} onChange={(e) => setLineas((x) => ({ ...x, [l.id]: e.target.value }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <label className="label">Motivo de la cancelación *</label>
          <textarea className="input text-sm" rows={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. El cliente redujo su pedido / producto en mal estado / error de captura" />
        </div>
        <p className="text-xs text-gray-400">La entrega aún no descuenta inventario, así que no hay movimiento de almacén; la mercancía sigue reservada para el pedido.</p>
        <div className="flex gap-3 pt-1">
          <button onClick={submit} disabled={mut.isPending} className="btn-primary">{mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />} Confirmar cancelación</button>
          <button onClick={onClose} className="btn-secondary">Volver</button>
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
  const [showOC, setShowOC] = useState(false);
  const [cancelEnt, setCancelEnt] = useState(null);
  const [confirmando, setConfirmando] = useState(null);
  const [timbrando, setTimbrando] = useState(null);

  const { data: ped, isLoading } = useQuery({
    queryKey: ['pedido', id], queryFn: () => api.get(`/ventas/pedidos/${id}`).then((r) => r.data),
  });

  function refrescar() { qc.invalidateQueries(['pedido', id]); setRecOC(null); setShowEntrega(false); setShowOC(false); setCancelEnt(null); }
  // Confirma una entrega pendiente: aquí se descuenta el inventario y se emite el documento.
  async function confirmarEntrega(ent) {
    const ok = await confirmar(
      `Se descontará del inventario (FEFO) la mercancía de ${ent.folio} y se emitirá el documento. ¿Confirmar la entrega?`,
      { titulo: 'Confirmar entrega', textoConfirmar: 'Confirmar entrega' }
    );
    if (!ok) return;
    setConfirmando(ent.id);
    try {
      const { data } = await api.post(`/ventas/entregas/${ent.id}/confirmar`);
      toast.success(`${data.tipo === 'factura' ? 'Factura' : 'Remisión'} ${data.folio} confirmada`);
      if (data.cfdi_txt) window.open(data.cfdi_txt, '_blank');
      refrescar();
    } catch (e) {
      const d = e.response?.data;
      if (e.response?.status === 422 && Array.isArray(d?.faltantes)) toast.error(`Faltan datos: ${d.faltantes.slice(0, 3).join('; ')}${d.faltantes.length > 3 ? '…' : ''}`);
      else toast.error(d?.error || 'Error al confirmar la entrega');
    } finally { setConfirmando(null); }
  }
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
          <p className="text-sm text-gray-500">{ped.cliente}{ped.sucursal ? ` · ${ped.sucursal}` : ''} · Cotización <Link to={`/cotizaciones/${ped.cotizacion_id}`} className="text-brand-500">{ped.cotizacion_folio}</Link></p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowOC(true)} className="btn-secondary"><FileText size={15} /> Generar órdenes de compra</button>
          <button onClick={() => setShowEntrega(true)} className="btn-primary"><Truck size={15} /> Generar entrega</button>
        </div>
      </div>

      {/* Avance de partidas */}
      <div className="card overflow-x-auto">
        <h2 className="font-semibold text-gray-800 mb-3">Partidas del pedido</h2>
        <table className="table-auto w-full text-sm">
          <thead><tr><th>SKU</th><th>Descripción</th><th>Proveedor</th><th className="text-right">Asignado</th><th className="text-right">Recibido</th><th className="text-right">Reservado</th><th className="text-right">Entregado</th><th className="text-right">Stock</th></tr></thead>
          <tbody>
            {ped.partidas?.map((p) => (
              <tr key={p.id}>
                <td className="font-mono text-xs text-brand-500">{p.sku_interno}</td>
                <td className="max-w-xs truncate">{p.descripcion}</td>
                <td className="text-xs">{p.proveedor || <span className="text-amber-500">sin proveedor</span>}</td>
                <td className="text-right">{Number(p.cantidad_asignada)}</td>
                <td className="text-right">{Number(p.cantidad_recibida)}</td>
                <td className="text-right">{Number(p.cantidad_reservada) > 0 ? <span className="badge-blue">{Number(p.cantidad_reservada)}</span> : 0}</td>
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
          <p className="text-sm text-gray-400">Aún no se generan. Usa «Generar órdenes de compra» (no se pide lo reservado del inventario).</p>
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
            <thead><tr><th>Folio</th><th>Tipo</th><th className="text-right">Total</th><th className="text-center">Estatus</th><th className="text-center">CFDI</th><th>Fecha</th><th></th></tr></thead>
            <tbody>
              {ped.entregas.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-brand-500">{e.folio}</td>
                  <td className="capitalize">{e.tipo}{e.factura_folio && <span className="ml-2 badge-green normal-case">facturada en {e.factura_folio}</span>}{e.tipo === 'remision' && !e.factura_folio && <Link to="/ventas/facturar-remisiones" className="ml-2 text-xs normal-case text-brand-500 hover:underline">Facturar…</Link>}</td>
                  <td className="text-right">{fmt(e.total)}</td>
                  <td className="text-center">
                    <span className={ENT_BADGE[e.estatus] || 'badge-gray'}>{e.estatus}</span>
                    {e.estatus === 'cancelada' && e.motivo_cancelacion && <p className="text-xs text-gray-400 max-w-[14rem] mx-auto truncate" title={e.motivo_cancelacion}>{e.motivo_cancelacion}</p>}
                  </td>
                  <td className="text-center">{e.tipo === 'factura' && e.estatus === 'confirmada' ? <span className={CFDI_BADGE[e.estatus_cfdi] || 'badge-gray'}>{e.estatus_cfdi || 'pendiente'}</span> : <span className="text-gray-300">—</span>}</td>
                  <td>{new Date(e.created_at).toLocaleDateString('es-MX')}</td>
                  <td className="text-right whitespace-nowrap">
                    {e.estatus === 'pendiente' && (
                      <>
                        <button onClick={() => confirmarEntrega(e)} disabled={confirmando === e.id} className="text-xs text-emerald-600 hover:underline mr-3">
                          {confirmando === e.id ? <Loader2 size={14} className="inline animate-spin" /> : <PackageCheck size={14} className="inline" />} Confirmar
                        </button>
                        <button onClick={() => setCancelEnt(e)} className="text-xs text-red-500 hover:underline"><Ban size={14} className="inline" /> Cancelar</button>
                      </>
                    )}
                    {e.estatus !== 'cancelada' && <button onClick={async () => { const { data } = await api.get(`/ventas/entregas/${e.id}/pdf`); abrirPdf(data.url); }} className="text-xs text-gray-500 hover:text-brand-500 mr-3"><Download size={14} className="inline" /> PDF</button>}
                    {e.estatus === 'confirmada' && e.tipo === 'factura' && e.estatus_cfdi !== 'timbrado' && e.estatus_cfdi !== 'cancelado' && (
                      <button onClick={() => timbrar(e.id)} disabled={timbrando === e.id} className="text-xs text-emerald-600 hover:underline mr-3">
                        {timbrando === e.id ? <Loader2 size={14} className="inline animate-spin" /> : <Stamp size={14} className="inline" />} Timbrar
                      </button>
                    )}
                    {e.estatus === 'confirmada' && e.tipo === 'factura' && e.estatus_cfdi === 'timbrado' && (
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
      {showOC && <OCModal pedido={ped} onClose={() => setShowOC(false)} onDone={refrescar} />}
      {cancelEnt && <CancelarEntregaModal entrega={cancelEnt} onClose={() => setCancelEnt(null)} onDone={refrescar} />}

      {dialogoConfirm}
    </div>
  );
}
