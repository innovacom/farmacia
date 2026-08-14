import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, MapPin, Store, Phone, Mail, Ban, CreditCard } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';

const money = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const ESTATUS_LABEL = {
  pendiente: 'Pendiente', preparando: 'Preparando', listo: 'Listo',
  en_reparto: 'En reparto', entregado: 'Entregado', cancelado: 'Cancelado',
};
const ESTATUS_BADGE = {
  pendiente: 'badge-yellow', preparando: 'badge-yellow', listo: 'badge-green',
  en_reparto: 'badge-green', entregado: 'badge-green', cancelado: 'badge-gray',
};

/**
 * Pedidos pagados en línea con Stripe Checkout en /tienda (ver
 * tienda.checkout.service.js) — clon de PedidosWhatsApp.jsx con dos
 * diferencias: no hay receta (solo se vende libre venta en línea) y
 * cancelar dispara un reembolso REAL por Stripe, no solo reingresa
 * inventario — a diferencia de un pedido de WhatsApp, este SÍ se cobró.
 */
export default function PedidosTienda() {
  const qc = useQueryClient();
  const [estatus, setEstatus] = useState('');
  const [pedidoId, setPedidoId] = useState(null);

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['tienda-pedidos', estatus],
    queryFn: () => api.get('/tienda/admin/pedidos', { params: estatus ? { estatus } : {} }).then((r) => r.data),
    refetchInterval: 30000,
  });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-6">
        <ShoppingBag size={22} className="text-brand-500" />
        <h1 className="text-2xl font-bold text-gray-900">Pedidos de la tienda en línea</h1>
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">Estatus:</span>
          {['', 'pendiente', 'preparando', 'listo', 'en_reparto', 'entregado', 'cancelado'].map((e) => (
            <button
              key={e || 'todos'}
              className={`btn-sm ${estatus === e ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setEstatus(e)}
            >
              {e ? ESTATUS_LABEL[e] : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-gray-400">Cargando…</p>
      ) : !pedidos.length ? (
        <div className="card text-center text-gray-500 py-10">Sin pedidos de la tienda en línea con ese filtro.</div>
      ) : (
        <div className="space-y-2">
          {pedidos.map((p) => (
            <button
              key={p.id}
              className="card w-full text-left flex items-start gap-4 hover:border-brand-300 border border-transparent"
              onClick={() => setPedidoId(p.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{p.folio}</p>
                  <span className={ESTATUS_BADGE[p.estatus]}>{ESTATUS_LABEL[p.estatus]}</span>
                  {p.reembolsado_en && <span className="badge-gray">Reembolsado</span>}
                  {p.reembolso_error && <span className="badge-red">Reembolso falló</span>}
                </div>
                <p className="text-sm text-gray-600 mt-0.5">{p.nombre_recibe} · {p.telefono}</p>
                <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                  {p.forma_entrega === 'domicilio' ? <MapPin size={12} /> : <Store size={12} />}
                  {p.forma_entrega === 'domicilio' ? 'A domicilio' : 'Recoge en tienda'} · {p.sucursal}
                </p>
              </div>
              <p className="font-semibold text-gray-900 shrink-0">{money(p.total)}</p>
            </button>
          ))}
        </div>
      )}

      {pedidoId && (
        <DetallePedido pedidoId={pedidoId} onClose={() => setPedidoId(null)}
          onCambio={() => { qc.invalidateQueries({ queryKey: ['tienda-pedidos'] }); }} />
      )}
    </div>
  );
}

function DetallePedido({ pedidoId, onClose, onCambio }) {
  const [motivoCancelar, setMotivoCancelar] = useState(null); // null | ''

  const { data: p, isLoading, refetch } = useQuery({
    queryKey: ['tienda-pedido', pedidoId],
    queryFn: () => api.get(`/tienda/admin/pedidos/${pedidoId}`).then((r) => r.data),
  });

  const invalidar = () => { refetch(); onCambio(); };

  const accion = useMutation({
    mutationFn: (ruta) => api.post(`/tienda/admin/pedidos/${pedidoId}/${ruta}`, {}),
    onSuccess: () => { toast.success('Actualizado'); invalidar(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al actualizar'),
  });

  const cancelar = useMutation({
    mutationFn: (motivo) => api.post(`/tienda/admin/pedidos/${pedidoId}/cancelar`, { motivo }),
    onSuccess: () => { toast.success('Pedido cancelado y reembolsado'); setMotivoCancelar(null); invalidar(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al cancelar'),
  });

  if (isLoading || !p) {
    return <Modal title="Pedido" onClose={onClose} size="lg"><p className="text-gray-400">Cargando…</p></Modal>;
  }

  const puedeCancelar = !['entregado', 'cancelado'].includes(p.estatus);

  return (
    <Modal title={`Pedido ${p.folio}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={ESTATUS_BADGE[p.estatus]}>{ESTATUS_LABEL[p.estatus]}</span>
          <span className="badge-green"><CreditCard size={11} className="inline -mt-0.5 mr-0.5" />Pagado con tarjeta</span>
          {p.reembolsado_en && <span className="badge-gray">Reembolsado</span>}
          {p.reembolso_error && <span className="badge-red" title={p.reembolso_error}>Reembolso falló — revisar en Stripe</span>}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-gray-400">Cliente</p>
            <p className="font-medium text-gray-900">{p.nombre_recibe}</p>
            <p className="text-gray-500 flex items-center gap-1"><Phone size={12} /> {p.telefono}</p>
            <p className="text-gray-500 flex items-center gap-1"><Mail size={12} /> {p.correo}</p>
          </div>
          <div>
            <p className="text-gray-400">Entrega</p>
            <p className="font-medium text-gray-900">{p.forma_entrega === 'domicilio' ? 'A domicilio' : 'Recoge en tienda'}</p>
            {p.direccion_entrega && <p className="text-gray-500">{p.direccion_entrega}</p>}
          </div>
          <div>
            <p className="text-gray-400">Sucursal</p>
            <p className="font-medium text-gray-900">{p.sucursal || '—'}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-100">
              <th className="py-1">Producto</th>
              <th className="py-1 text-right">Cant.</th>
              <th className="py-1 text-right">P. unit.</th>
              <th className="py-1 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {p.partidas.map((it) => (
              <tr key={it.id} className="border-b border-gray-50">
                <td className="py-1">{it.descripcion}</td>
                <td className="py-1 text-right">{Number(it.cantidad)}</td>
                <td className="py-1 text-right">{money(it.precio_unitario)}</td>
                <td className="py-1 text-right">{money(it.importe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-right text-sm space-y-0.5">
          <p className="text-gray-500">Subtotal: {money(p.subtotal)}</p>
          <p className="text-gray-500">IVA: {money(p.iva)}</p>
          {Number(p.costo_envio) > 0 && <p className="text-gray-500">Envío: {money(p.costo_envio)}</p>}
          <p className="font-semibold text-gray-900">Total: {money(p.total)}</p>
        </div>

        {p.estatus === 'cancelado' && p.motivo_cancelacion && (
          <p className="text-sm text-gray-400">Motivo de cancelación: {p.motivo_cancelacion}</p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-gray-100">
          {p.estatus === 'pendiente' && (
            <button className="btn-primary" disabled={accion.isPending} onClick={() => accion.mutate('preparar')}>Marcar en preparación</button>
          )}
          {p.estatus === 'preparando' && (
            <button className="btn-primary" disabled={accion.isPending} onClick={() => accion.mutate('listo')}>Marcar listo</button>
          )}
          {p.estatus === 'listo' && p.forma_entrega === 'domicilio' && (
            <button className="btn-primary" disabled={accion.isPending} onClick={() => accion.mutate('reparto')}>Enviar a reparto</button>
          )}
          {(p.estatus === 'listo' || p.estatus === 'en_reparto') && (
            <button className="btn-primary" disabled={accion.isPending} onClick={() => accion.mutate('entregar')}>
              Marcar entregado
            </button>
          )}
          {puedeCancelar && (
            <button className="btn-secondary text-red-600" disabled={cancelar.isPending} onClick={() => setMotivoCancelar('')}>
              <Ban size={14} /> Cancelar y reembolsar
            </button>
          )}
        </div>

        {motivoCancelar !== null && (
          <div className="border border-red-100 bg-red-50 rounded-xl p-3 space-y-2">
            <p className="text-sm text-red-700">
              Se reingresará el inventario apartado y se reembolsará el pago completo por Stripe. ¿Motivo? (obligatorio)
            </p>
            <textarea className="input" rows={2} value={motivoCancelar} autoFocus
              onChange={(e) => setMotivoCancelar(e.target.value)} placeholder="Ej. Sin existencia / el cliente lo solicitó" />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary btn-sm" onClick={() => setMotivoCancelar(null)}>Cerrar</button>
              <button className="btn-primary btn-sm bg-red-600 hover:bg-red-700" disabled={cancelar.isPending || !motivoCancelar.trim()}
                onClick={() => cancelar.mutate(motivoCancelar.trim())}>
                Confirmar cancelación y reembolso
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
