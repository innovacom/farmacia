// Ícono de carrito con contador — se inserta suelto en el header de
// Catalogo.jsx y de DetalleProducto.jsx (esos dos headers son
// estructuralmente distintos, no vale la pena forzar un header compartido
// solo por esto). Oculto por completo si el pago en línea no está
// configurado (info.pago_habilitado) — mismo criterio que el botón de
// WhatsApp cuando TIENDA_WHATSAPP_NUMERO no está puesto.
import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { useTiendaCarrito } from '../../store/tiendaCarritoStore';

export default function CarritoBadge({ pagoHabilitado }) {
  const totalPiezas = useTiendaCarrito((s) => s.totalPiezas());
  if (!pagoHabilitado) return null;

  return (
    <Link
      to="/tienda/carrito"
      className="relative flex items-center justify-center w-10 h-10 rounded-full bg-white
                 ring-1 ring-tienda-ink/10 text-tienda-ink hover:text-tienda-teal transition-colors shrink-0"
      title="Ver carrito"
    >
      <ShoppingCart size={18} />
      {totalPiezas > 0 && (
        <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1
                          rounded-full bg-tienda-teal text-white text-[10px] font-bold">
          {totalPiezas}
        </span>
      )}
    </Link>
  );
}
