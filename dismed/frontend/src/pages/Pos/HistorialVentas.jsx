import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { History, Printer, Ban, Receipt } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import { useBranding } from '../../hooks/useBranding';
import TicketPrint, { usePrintTicket } from './components/TicketPrint';

const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/** Historial de ventas de mostrador: reimpresión de ticket y cancelación
 *  (solo mismo turno abierto y sin factura — el backend lo valida). */
export default function HistorialVentas() {
  const qc = useQueryClient();
  const branding = useBranding();
  const imprimir = usePrintTicket(branding);
  const { confirmar, dialogoConfirm } = useConfirm();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [detalle, setDetalle] = useState(null);   // venta con partidas
  const [paraTicket, setParaTicket] = useState(null);
  const [facturando, setFacturando] = useState(null); // venta a facturar

  const { data = [] } = useQuery({
    queryKey: ['pos-ventas', desde, hasta],
    queryFn: () => api.get('/pos/ventas', { params: { desde: desde || undefined, hasta: hasta || undefined } })
      .then((r) => r.data),
  });
  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(data);

  async function verDetalle(id) {
    try {
      const { data: v } = await api.get(`/pos/ventas/${id}`);
      setDetalle(v);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Error al cargar la venta');
    }
  }

  async function reimprimir(id) {
    const { data: v } = await api.get(`/pos/ventas/${id}`);
    setParaTicket(v);
    setTimeout(() => imprimir(), 150);
  }

  const cancelar = useMutation({
    mutationFn: ({ id, motivo }) => api.post(`/pos/ventas/${id}/cancelar`, { motivo }),
    onSuccess: () => {
      toast.success('Venta cancelada; el inventario se reingresó');
      qc.invalidateQueries({ queryKey: ['pos-ventas'] });
      setDetalle(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo cancelar'),
  });

  async function onCancelar(v) {
    if (!(await confirmar(
      `Se cancelará la venta ${v.folio} y su inventario se reingresará al almacén.`,
      { titulo: 'Cancelar venta', textoConfirmar: 'Cancelar venta' }
    ))) return;
    cancelar.mutate({ id: v.id, motivo: 'Cancelación en mostrador' });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <History size={22} className="text-brand-500" />
        <h1 className="text-2xl font-bold text-gray-900">Ventas de mostrador</h1>
      </div>

      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Desde</label>
          <input type="date" className="input" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input type="date" className="input" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>Folio</th><th>Fecha</th><th>Sucursal / Caja</th><th>Cajero</th>
              <th className="text-right">Total</th><th>Pago</th><th>Estatus</th><th />
            </tr>
          </thead>
          <tbody>
            {pageItems.map((v) => (
              <tr key={v.id} className="cursor-pointer" onClick={() => verDetalle(v.id)}>
                <td className="font-mono text-xs">{v.folio}</td>
                <td>{new Date(v.created_at).toLocaleString('es-MX')}</td>
                <td>{v.sucursal} · {v.caja}</td>
                <td>{v.cajero}</td>
                <td className="text-right font-semibold">{money(v.total)}</td>
                <td className="text-xs">
                  {Number(v.pago_efectivo) > 0 && <span>Efectivo </span>}
                  {Number(v.pago_tarjeta) > 0 && <span>Tarjeta</span>}
                </td>
                <td>
                  {v.estatus === 'cancelada'
                    ? <span className="badge-red">Cancelada</span>
                    : v.factura_estado === 'individual'
                      ? <span className="badge-blue">Facturada</span>
                      : v.factura_estado === 'global'
                        ? <span className="badge-gray">Fact. global</span>
                        : <span className="badge-green">Completada</span>}
                </td>
                <td className="text-right" onClick={(e) => e.stopPropagation()}>
                  <button className="p-1.5 text-gray-400 hover:text-brand-500" title="Reimprimir ticket"
                    onClick={() => reimprimir(v.id)}>
                    <Printer size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {!pageItems.length && (
              <tr><td colSpan={8} className="text-center text-gray-400 py-8">Sin ventas</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} from={from} to={to} />

      {detalle && (
        <Modal title={`Venta ${detalle.folio}`} onClose={() => setDetalle(null)} size="lg">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><span className="text-gray-500">Fecha:</span> {new Date(detalle.created_at).toLocaleString('es-MX')}</p>
              <p><span className="text-gray-500">Cajero:</span> {detalle.cajero}</p>
              <p><span className="text-gray-500">Sucursal:</span> {detalle.sucursal} · {detalle.caja}</p>
              <p><span className="text-gray-500">Estatus:</span> {detalle.estatus} / {detalle.factura_estado}</p>
            </div>
            <table className="table-auto w-full">
              <thead><tr><th>Producto</th><th className="text-center">Cant.</th><th>Lotes</th><th className="text-right">Importe</th></tr></thead>
              <tbody>
                {detalle.partidas.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.descripcion}
                      {p.folio_receta || p.medico ? (
                        <p className="text-xs text-gray-400">
                          Receta {p.folio_receta || 's/folio'} · {p.medico} ({p.cedula_profesional})
                        </p>
                      ) : null}
                    </td>
                    <td className="text-center">{Number(p.cantidad)}</td>
                    <td className="text-xs text-gray-500">
                      {(typeof p.lotes_json === 'string' ? JSON.parse(p.lotes_json || '[]') : p.lotes_json || [])
                        .map((l) => `${l.lote} (${Number(l.cantidad)})`).join(', ')}
                    </td>
                    <td className="text-right">{money(p.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-right text-lg font-bold">{money(detalle.total)}</div>
            <div className="flex justify-between pt-2">
              {detalle.estatus === 'completada' && detalle.factura_estado === 'sin_factura' ? (
                <div className="flex gap-2">
                  <button className="btn-danger" onClick={() => onCancelar(detalle)} disabled={cancelar.isPending}>
                    <Ban size={15} /> Cancelar venta
                  </button>
                  <button className="btn-primary" onClick={() => setFacturando(detalle)}>
                    <Receipt size={15} /> Facturar (CFDI)
                  </button>
                </div>
              ) : <span />}
              <button className="btn-secondary" onClick={() => { setParaTicket(detalle); setTimeout(() => imprimir(), 150); }}>
                <Printer size={15} /> Reimprimir ticket
              </button>
            </div>
          </div>
        </Modal>
      )}

      {facturando && (
        <ModalFacturar
          venta={facturando}
          onClose={() => setFacturando(null)}
          onFacturada={() => {
            setFacturando(null); setDetalle(null);
            qc.invalidateQueries({ queryKey: ['pos-ventas'] });
          }}
        />
      )}

      <TicketPrint venta={paraTicket} branding={branding} />
      {dialogoConfirm}
    </div>
  );
}

const USOS_CFDI = [
  ['G03', 'G03 — Gastos en general'],
  ['G01', 'G01 — Adquisición de mercancías'],
  ['D01', 'D01 — Honorarios médicos y gastos hospitalarios'],
  ['D02', 'D02 — Gastos médicos por incapacidad'],
  ['S01', 'S01 — Sin efectos fiscales'],
];

function ModalFacturar({ venta, onClose, onFacturada }) {
  const [receptor, setReceptor] = useState({
    rfc: '', razon_social: '', codigo_postal: '', regimen_fiscal: '612', uso_cfdi: 'G03',
  });
  const set = (k, v) => setReceptor((r) => ({ ...r, [k]: v }));
  const valido = receptor.rfc.trim().length >= 12 && receptor.razon_social.trim()
    && receptor.codigo_postal.trim().length === 5 && receptor.regimen_fiscal && receptor.uso_cfdi;

  const facturar = useMutation({
    mutationFn: () => api.post(`/pos/ventas/${venta.id}/facturar`, { receptor }),
    onSuccess: ({ data }) => { toast.success(`CFDI timbrado (${data.uuid})`); onFacturada(); },
    onError: (e) => {
      const f = e.response?.data?.faltantes;
      toast.error((e.response?.data?.error || 'Error al timbrar') + (f ? `: ${f.join(', ')}` : ''));
    },
  });

  return (
    <Modal title={`Facturar ${venta.folio} — ${money(venta.total)}`} onClose={onClose} size="md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input className="input font-mono" placeholder="RFC" maxLength={13} autoFocus
            value={receptor.rfc} onChange={(e) => set('rfc', e.target.value.toUpperCase())} />
          <input className="input" placeholder="Razón social / nombre"
            value={receptor.razon_social} onChange={(e) => set('razon_social', e.target.value)} />
          <input className="input" placeholder="C.P. fiscal" maxLength={5}
            value={receptor.codigo_postal} onChange={(e) => set('codigo_postal', e.target.value)} />
          <input className="input" placeholder="Régimen fiscal (ej. 612)" maxLength={3}
            value={receptor.regimen_fiscal} onChange={(e) => set('regimen_fiscal', e.target.value)} />
          <select className="input col-span-2" value={receptor.uso_cfdi}
            onChange={(e) => set('uso_cfdi', e.target.value)}>
            {USOS_CFDI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valido || facturar.isPending}
            onClick={() => facturar.mutate()}>
            {facturar.isPending ? 'Timbrando…' : 'Timbrar CFDI'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
