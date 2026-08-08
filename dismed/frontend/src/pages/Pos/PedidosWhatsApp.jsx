import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, MapPin, Store, Phone, Check, Ban, ImageOff } from 'lucide-react';
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
const RECETA_LABEL = {
  pendiente: 'Falta foto de receta', recibida: 'Receta por validar',
  validada: 'Receta validada', rechazada: 'Receta rechazada',
};
const RECETA_BADGE = {
  pendiente: 'badge-yellow', recibida: 'badge-yellow', validada: 'badge-green', rechazada: 'badge-red',
};

/**
 * Pedidos en firme armados por el carrito conversacional de WhatsApp (ver
 * backend whatsapp.carrito.service.js) — no pasan por solicitud/cotización.
 * El inventario ya se descontó por FEFO al confirmarse; cancelar aquí SIEMPRE
 * lo reingresa (whatsapp.pedidos.service#cancelar).
 */
export default function PedidosWhatsApp() {
  const qc = useQueryClient();
  const [estatus, setEstatus] = useState('');
  const [pedidoId, setPedidoId] = useState(null);

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['wa-pedidos', estatus],
    queryFn: () => api.get('/whatsapp/pedidos', { params: estatus ? { estatus } : {} }).then((r) => r.data),
    refetchInterval: 30000,
  });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-6">
        <ShoppingBag size={22} className="text-brand-500" />
        <h1 className="text-2xl font-bold text-gray-900">Pedidos WhatsApp</h1>
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
        <div className="card text-center text-gray-500 py-10">Sin pedidos por WhatsApp con ese filtro.</div>
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
                  {p.receta_estatus !== 'no_aplica' && (
                    <span className={RECETA_BADGE[p.receta_estatus]}>{RECETA_LABEL[p.receta_estatus]}</span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-0.5">{p.contacto_nombre || p.nombre_recibe || 'Sin nombre'} · {p.telefono}</p>
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
          onCambio={() => { qc.invalidateQueries({ queryKey: ['wa-pedidos'] }); }} />
      )}
    </div>
  );
}

function DetallePedido({ pedidoId, onClose, onCambio }) {
  const [motivoCancelar, setMotivoCancelar] = useState(null); // null | ''

  const { data: p, isLoading, refetch } = useQuery({
    queryKey: ['wa-pedido', pedidoId],
    queryFn: () => api.get(`/whatsapp/pedidos/${pedidoId}`).then((r) => r.data),
  });

  const invalidar = () => { refetch(); onCambio(); };

  const accion = useMutation({
    mutationFn: (ruta) => api.post(`/whatsapp/pedidos/${pedidoId}/${ruta}`, {}),
    onSuccess: () => { toast.success('Actualizado'); invalidar(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al actualizar'),
  });

  const cancelar = useMutation({
    mutationFn: (motivo) => api.post(`/whatsapp/pedidos/${pedidoId}/cancelar`, { motivo }),
    onSuccess: () => { toast.success('Pedido cancelado, inventario reingresado'); setMotivoCancelar(null); invalidar(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al cancelar'),
  });

  const validarReceta = useMutation({
    mutationFn: (aprobar) => api.post(`/whatsapp/pedidos/${pedidoId}/receta/validar`, { aprobar }),
    onSuccess: () => { toast.success('Receta actualizada'); invalidar(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al validar la receta'),
  });

  if (isLoading || !p) {
    return <Modal title="Pedido" onClose={onClose} size="lg"><p className="text-gray-400">Cargando…</p></Modal>;
  }

  const puedeCancelar = !['entregado', 'cancelado'].includes(p.estatus);
  const recetaBloqueaEntrega = p.receta_estatus === 'pendiente' || p.receta_estatus === 'recibida';

  return (
    <Modal title={`Pedido ${p.folio}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={ESTATUS_BADGE[p.estatus]}>{ESTATUS_LABEL[p.estatus]}</span>
          {p.receta_estatus !== 'no_aplica' && <span className={RECETA_BADGE[p.receta_estatus]}>{RECETA_LABEL[p.receta_estatus]}</span>}
          {p.pagado ? <span className="badge-green">Pagado</span> : <span className="badge-yellow">Sin pagar</span>}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-gray-400">Cliente</p>
            <p className="font-medium text-gray-900">{p.nombre_recibe}</p>
            <p className="text-gray-500 flex items-center gap-1"><Phone size={12} /> {p.telefono}</p>
          </div>
          <div>
            <p className="text-gray-400">Entrega</p>
            <p className="font-medium text-gray-900">{p.forma_entrega === 'domicilio' ? 'A domicilio' : 'Recoge en tienda'}</p>
            {p.direccion_entrega && <p className="text-gray-500">{p.direccion_entrega}</p>}
          </div>
          <div>
            <p className="text-gray-400">Pago</p>
            <p className="font-medium text-gray-900 capitalize">{p.forma_pago}</p>
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
                <td className="py-1">{it.descripcion}{!!it.requiere_receta && <span className="badge-yellow ml-1">Receta</span>}</td>
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
          <p className="font-semibold text-gray-900">Total: {money(p.total)}</p>
        </div>

        {p.receta_estatus !== 'no_aplica' && (
          <div className="border border-gray-100 rounded-xl p-3">
            <p className="text-sm font-medium text-gray-700 mb-2">Receta médica</p>
            <FotoReceta pedidoId={pedidoId} disponible={!!p.receta_foto_path} />
            {p.receta_estatus === 'recibida' && (
              <div className="flex gap-2 mt-3">
                <button className="btn-primary btn-sm" disabled={validarReceta.isPending} onClick={() => validarReceta.mutate(true)}>
                  <Check size={14} /> Válida
                </button>
                <button className="btn-secondary btn-sm" disabled={validarReceta.isPending} onClick={() => validarReceta.mutate(false)}>
                  <Ban size={14} /> Rechazar
                </button>
              </div>
            )}
            {p.receta_estatus === 'rechazada' && p.receta_motivo_rechazo && (
              <p className="text-xs text-red-500 mt-1">Motivo: {p.receta_motivo_rechazo}</p>
            )}
          </div>
        )}

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
            <button
              className="btn-primary" disabled={accion.isPending || recetaBloqueaEntrega}
              title={recetaBloqueaEntrega ? 'Valida la receta antes de entregar' : ''}
              onClick={() => accion.mutate('entregar')}
            >
              Marcar entregado y pagado
            </button>
          )}
          {puedeCancelar && (
            <button className="btn-secondary text-red-600" disabled={cancelar.isPending} onClick={() => setMotivoCancelar('')}>
              <Ban size={14} /> Cancelar pedido
            </button>
          )}
        </div>

        {motivoCancelar !== null && (
          <div className="border border-red-100 bg-red-50 rounded-xl p-3 space-y-2">
            <p className="text-sm text-red-700">Se reingresará el inventario apartado de este pedido y se le avisará al cliente por WhatsApp. ¿Motivo? (obligatorio)</p>
            <textarea className="input" rows={2} value={motivoCancelar} autoFocus
              onChange={(e) => setMotivoCancelar(e.target.value)} placeholder="Ej. No pagó al recibir / receta inválida" />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary btn-sm" onClick={() => setMotivoCancelar(null)}>Cerrar</button>
              <button className="btn-primary btn-sm bg-red-600 hover:bg-red-700" disabled={cancelar.isPending || !motivoCancelar.trim()}
                onClick={() => cancelar.mutate(motivoCancelar.trim())}>
                Confirmar cancelación
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// La foto de receta nunca es estática (datos médicos) — se descarga con el
// token de sesión (axios) y se muestra como blob, no como <img src="...">.
function FotoReceta({ pedidoId, disponible }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!disponible) return;
    let objectUrl;
    api.get(`/whatsapp/pedidos/${pedidoId}/receta`, { responseType: 'blob' })
      .then((r) => { objectUrl = URL.createObjectURL(r.data); setUrl(objectUrl); })
      .catch(() => setError(true));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [pedidoId, disponible]);

  if (!disponible) return <p className="text-sm text-gray-400 flex items-center gap-1"><ImageOff size={14} /> Aún no llega la foto de la receta.</p>;
  if (error) return <p className="text-sm text-red-500">No se pudo cargar la foto.</p>;
  if (!url) return <p className="text-sm text-gray-400">Cargando foto…</p>;
  return <img src={url} alt="Receta médica" className="max-h-80 rounded-lg border border-gray-200" />;
}
