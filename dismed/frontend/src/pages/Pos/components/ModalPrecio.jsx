import { useState } from 'react';
import Modal from '../../../components/ui/Modal';

const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/**
 * Editar el precio de una línea del carrito por cualquier situación (producto
 * dañado, negociación, error de etiqueta, etc.). Cualquier cajero puede
 * hacerlo — no pide clave de supervisor — pero el motivo es obligatorio: el
 * backend lo exige de todas formas si el precio no coincide con el de
 * catálogo (ver pos.ventas.service.js#crearVenta), esto solo evita el rebote.
 * `item.precioLista` es siempre el precio de catálogo original, aunque la
 * línea ya se haya editado antes — así el reporte de precios modificados
 * compara siempre contra catálogo, no contra un valor intermedio.
 *
 * Si hay una promoción vigente (`item.precioPromo`), la comparación de "¿el
 * cajero cambió algo?" se hace contra ESE precio, no contra el de lista — si
 * no, reabrir el modal en una línea con promoción y darle "Aplicar" sin
 * tocar nada pediría un motivo de la nada. Editar a mano una línea con
 * promoción la apaga para esa línea (mutuamente excluyentes, ver
 * pos.ventas.service.js#crearVenta) — se avisa aquí mismo.
 */
export default function ModalPrecio({ item, onClose, onAplicar }) {
  const baseline = item.precioPromo ?? item.precioLista;
  const [precio, setPrecio] = useState(String(item.precio));
  const [motivo, setMotivo] = useState(item.motivoPrecio || '');

  const precioNum = Number(precio);
  const modificado = Number.isFinite(precioNum) && Math.abs(precioNum - baseline) > 0.005;
  const valido = precioNum > 0 && (!modificado || motivo.trim());

  function aplicar() {
    onAplicar({ precio: precioNum, motivo: modificado ? motivo.trim() : null });
  }

  return (
    <Modal title="Editar precio" onClose={onClose} size="sm">
      <div className="space-y-3">
        <div>
          <p className="font-medium text-gray-900">{item.descripcion}</p>
          <p className="text-xs text-gray-400">Precio de lista: {money(item.precioLista)}</p>
          {item.precioPromo != null && (
            <p className="text-xs text-brand-600">
              Precio con promoción{item.promocionNombre ? ` (${item.promocionNombre})` : ''}: {money(item.precioPromo)}
            </p>
          )}
        </div>
        <div>
          <label className="label">Precio a cobrar</label>
          <input
            className="input" type="number" min="0.01" step="0.01" autoFocus
            value={precio} onChange={(e) => setPrecio(e.target.value)}
          />
        </div>
        {modificado && item.precioPromo != null && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            Al capturar un precio distinto, la promoción deja de aplicarse en esta línea.
          </p>
        )}
        {modificado && (
          <div>
            <label className="label">Motivo (obligatorio)</label>
            <textarea
              className="input" rows={2} autoFocus={false}
              placeholder="Producto dañado, negociación con el cliente, error de etiqueta…"
              value={motivo} onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valido} onClick={aplicar}>
            Aplicar
          </button>
        </div>
      </div>
    </Modal>
  );
}
