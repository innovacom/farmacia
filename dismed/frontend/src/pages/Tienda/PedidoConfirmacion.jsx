// Página de regreso tras pagar en Stripe Checkout (success_url = /tienda/pedido/exito?session_id=...).
// El pedido en firme nace en el webhook (tienda.checkout.service.js#confirmarPago),
// que puede tardar unos segundos más que el redirect del navegador — por eso
// se consulta con reintentos breves en vez de esperar una respuesta inmediata.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, HelpCircle } from 'lucide-react';
import api from '../../services/apiTienda';
import TiendaFooter from './TiendaFooter';
import { useTiendaCarrito } from '../../store/tiendaCarritoStore';

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

const MAX_INTENTOS = 10;

export default function PedidoConfirmacion() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const vaciarCarrito = useTiendaCarrito((s) => s.vaciar);
  const [intentos, setIntentos] = useState(0);

  // Llegar a esta página YA implica que Stripe confirmó el pago (es su propio
  // success_url) — el carrito se limpia de inmediato, sin esperar al webhook.
  useEffect(() => { vaciarCarrito(); }, [vaciarCarrito]);

  const { data: info } = useQuery({
    queryKey: ['tienda-info'],
    queryFn: () => api.get('/tienda/info').then((r) => r.data),
  });

  const { data } = useQuery({
    queryKey: ['tienda-pedido-confirmacion', sessionId],
    queryFn: () => api.get('/tienda/pedido-confirmacion', { params: { session_id: sessionId } })
      .then((r) => { setIntentos((n) => n + 1); return r.data; }),
    enabled: !!sessionId,
    refetchInterval: (query) => (query.state.data?.estatus === 'procesando' && intentos < MAX_INTENTOS ? 2000 : false),
  });

  let estatus = !sessionId ? 'invalido' : (data?.estatus || 'procesando');
  // Se agotaron los reintentos y el webhook sigue sin aterrizar — no dejar el
  // spinner girando para siempre.
  if (estatus === 'procesando' && intentos >= MAX_INTENTOS) estatus = 'no_encontrado';

  return (
    <div className="min-h-screen bg-tienda-surface font-tienda text-tienda-ink">
      <header className="sticky top-0 z-10 bg-gradient-to-b from-tienda-tealsoft to-tienda-surface border-b border-tienda-teal/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          {info?.logo_url && <img src={info.logo_url} alt="" className="h-8 w-8 object-contain shrink-0" />}
          <h1 className="font-tienda-display text-lg font-extrabold text-tienda-ink tracking-tight">
            {info?.nombre || 'Farmacia'}
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-16 text-center">
        {estatus === 'procesando' && (
          <>
            <Clock size={44} className="mx-auto text-tienda-teal mb-4 animate-pulse" />
            <h2 className="font-tienda-display text-xl font-extrabold text-tienda-ink">Confirmando tu pago…</h2>
            <p className="text-sm text-tienda-muted mt-2">Esto toma solo unos segundos, no cierres esta página.</p>
          </>
        )}

        {estatus === 'confirmado' && (
          <>
            <CheckCircle2 size={44} className="mx-auto text-tienda-teal mb-4" />
            <h2 className="font-tienda-display text-2xl font-extrabold text-tienda-ink">¡Pedido confirmado!</h2>
            <p className="text-sm text-tienda-muted mt-2">
              Folio <span className="font-semibold text-tienda-ink">{data.pedido.folio}</span> · Total {money(data.pedido.total)}
            </p>
            <p className="text-sm text-tienda-muted mt-1">
              {data.pedido.forma_entrega === 'domicilio' ? 'Te lo llevamos a domicilio.' : 'Puedes recogerlo en la sucursal elegida.'}
            </p>
            <p className="text-xs text-tienda-muted mt-4">Te llegó un recibo de Stripe a tu correo.</p>
            <Link to="/tienda" className="inline-block mt-6 text-tienda-teal text-sm font-medium hover:underline">
              Seguir comprando
            </Link>
          </>
        )}

        {(estatus === 'no_encontrado' || estatus === 'invalido') && (
          <>
            <HelpCircle size={44} className="mx-auto text-tienda-ink/15 mb-4" />
            <h2 className="font-tienda-display text-xl font-extrabold text-tienda-ink">No encontramos tu pedido</h2>
            <p className="text-sm text-tienda-muted mt-2 max-w-sm mx-auto">
              Si tu pago fue exitoso, en un momento te llegará el recibo por correo. Si tarda demasiado, contáctanos por WhatsApp.
            </p>
            <Link to="/tienda" className="inline-block mt-6 text-tienda-teal text-sm font-medium hover:underline">
              Volver al catálogo
            </Link>
          </>
        )}
      </main>

      <TiendaFooter info={info} />
    </div>
  );
}
