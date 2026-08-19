// Ícono de cuenta — mismo criterio de inserción suelta que CarritoBadge.jsx
// (los headers de Catalogo.jsx y DetalleProducto.jsx son distintos entre
// sí). A diferencia del carrito, no se oculta según config: si el acceso por
// WhatsApp no está disponible, /tienda/cuenta lo explica ahí mismo al
// intentar pedir el código, no aquí.
import { Link } from 'react-router-dom';
import { User } from 'lucide-react';
import { useTiendaAuth } from '../../store/tiendaAuthStore';

export default function CuentaBadge() {
  const { token, cliente } = useTiendaAuth();

  return (
    <Link
      to={token ? '/tienda/mi-cuenta' : '/tienda/cuenta'}
      className="flex items-center justify-center w-10 h-10 rounded-full bg-white
                 ring-1 ring-tienda-ink/10 text-tienda-ink hover:text-tienda-teal transition-colors shrink-0"
      title={token ? `Mi cuenta — ${cliente?.nombre || ''}` : 'Iniciar sesión'}
    >
      <User size={18} />
    </Link>
  );
}
