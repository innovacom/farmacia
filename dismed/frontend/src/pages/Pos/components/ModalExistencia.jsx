import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Modal from '../../../components/ui/Modal';
import api from '../../../services/api';

/**
 * Alta rápida de existencia desde el mostrador: el producto YA existe en el
 * catálogo (por eso apareció en el buscador) pero no tiene piezas capturadas
 * en el almacén de esta sucursal — típico cuando llega mercancía y se vende
 * antes de pasar por Inventario > Movimientos. Registra la entrada (mismo
 * backend que usa esa pantalla, ver pos.ventas.service.js#registrarExistencia)
 * y regresa el producto ya con existencia, para agregarlo al carrito de una vez.
 */
export default function ModalExistencia({ producto, sucursalId, onClose, onRegistrada }) {
  const [cantidad, setCantidad] = useState('');
  const [costoUnitario, setCostoUnitario] = useState('');
  const [numeroLote, setNumeroLote] = useState('');
  const [fechaCaducidad, setFechaCaducidad] = useState('');

  const mut = useMutation({
    mutationFn: () => api.post(`/pos/productos/${producto.producto_id}/existencia`, {
      sucursal_id: sucursalId,
      presentacion_id: producto.presentacion_id || undefined,
      cantidad, costo_unitario: costoUnitario || undefined,
      numero_lote: numeroLote || undefined,
      fecha_caducidad: fechaCaducidad || undefined,
    }),
    onSuccess: ({ data }) => {
      toast.success(`Existencia registrada (${data.folio})`);
      onRegistrada(data.producto);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al registrar la existencia'),
  });

  const cantidadValida = Number(cantidad) > 0;
  const loteValido = !producto.control_lote_caducidad || numeroLote.trim();
  const valido = cantidadValida && loteValido;

  return (
    <Modal title="Registrar existencia" onClose={onClose} size="sm">
      <div className="space-y-3">
        <div>
          <p className="font-medium text-gray-900">{producto.descripcion}</p>
          <p className="text-xs text-gray-400 font-mono">{producto.sku_interno}</p>
        </div>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          Este producto ya está en el catálogo pero no tiene existencia capturada en esta
          sucursal. Captura lo que hay físicamente para poder venderlo.
        </p>
        <div>
          <label className="label">
            Cantidad{producto.presentacion_id ? ' (unidades de esta presentación)' : ' (piezas)'} *
          </label>
          <input
            className="input" type="number" min="0.01" step="any" autoFocus
            value={cantidad} onChange={(e) => setCantidad(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Costo unitario (opcional)</label>
          <input
            className="input" type="number" min="0" step="0.01"
            value={costoUnitario} onChange={(e) => setCostoUnitario(e.target.value)}
          />
        </div>
        {producto.control_lote_caducidad && (
          <>
            <div>
              <label className="label">Número de lote *</label>
              <input className="input" value={numeroLote} onChange={(e) => setNumeroLote(e.target.value)} />
            </div>
            <div>
              <label className="label">Fecha de caducidad</label>
              <input className="input" type="date" value={fechaCaducidad} onChange={(e) => setFechaCaducidad(e.target.value)} />
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valido || mut.isPending} onClick={() => mut.mutate()}>
            Registrar
          </button>
        </div>
      </div>
    </Modal>
  );
}
