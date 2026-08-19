// Carrito + inicio de pago — POST /tienda/checkout/iniciar redirige a Stripe
// Checkout (checkout.stripe.com); esta página nunca ve ni maneja datos de
// tarjeta. Los precios que se muestran aquí son solo de exhibición — el
// backend siempre re-precioteia con la BD antes de crear la sesión de pago
// (tienda.checkout.service.js#iniciar); si algo cambió (promoción vencida,
// sin existencia), el servidor responde con el error real, no lo que diga
// este carrito.
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Minus, Plus, Trash2, ShoppingBag, Store, Truck, User } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/apiTienda';
import TiendaFooter from './TiendaFooter';
import { useTiendaCarrito } from '../../store/tiendaCarritoStore';
import { useTiendaAuth } from '../../store/tiendaAuthStore';

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export default function Carrito() {
  const navigate = useNavigate();
  const { items, setCantidad, quitar } = useTiendaCarrito();
  const { token, cliente, logout } = useTiendaAuth();
  const [sucursalId, setSucursalId] = useState('');
  const [formaEntrega, setFormaEntrega] = useState('pickup');
  const [direccion, setDireccion] = useState('');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');

  const { data: info } = useQuery({
    queryKey: ['tienda-info'],
    queryFn: () => api.get('/tienda/info').then((r) => r.data),
  });

  // Con sesión iniciada, se autollena una sola vez con el perfil guardado
  // (incluye la dirección de entrega, que no viaja en el token) — el
  // pedido queda ligado a la cuenta automáticamente en el servidor por el
  // mismo token, sin nada más que hacer aquí.
  const { data: perfil } = useQuery({
    queryKey: ['tienda-cuenta-perfil'],
    queryFn: () => api.get('/tienda/cuenta/perfil').then((r) => r.data),
    enabled: !!token,
    retry: false,
  });
  useEffect(() => {
    if (!perfil) return;
    // perfil.telefono viene como 52 + 10 dígitos (mismo formato que guarda
    // el POS) — para el formulario de checkout se ve mejor a 10 dígitos.
    const telefonoLocal = String(perfil.telefono || '').replace(/\D/g, '').slice(-10);
    setNombre((v) => v || perfil.nombre || '');
    setTelefono((v) => v || telefonoLocal);
    setCorreo((v) => v || perfil.correo || '');
    setDireccion((v) => v || perfil.direccion_entrega || '');
  }, [perfil]);

  const sucursales = info?.sucursales || [];
  const subtotalAprox = items.reduce((acc, it) => acc + it.cantidad * Number(it.precio_final || 0), 0);
  const envio = formaEntrega === 'domicilio' ? Number(info?.envio_domicilio_costo || 0) : 0;
  const totalAprox = subtotalAprox + envio;

  const pagar = useMutation({
    mutationFn: () => api.post('/tienda/checkout/iniciar', {
      items: items.map((it) => ({ producto_id: it.producto_id, cantidad: it.cantidad })),
      sucursal_id: Number(sucursalId),
      forma_entrega: formaEntrega,
      direccion_entrega: formaEntrega === 'domicilio' ? direccion.trim() : undefined,
      nombre_recibe: nombre.trim(),
      telefono: telefono.trim(),
      correo: correo.trim(),
    }).then((r) => r.data),
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo iniciar el pago'),
  });

  function irAPagar() {
    if (!items.length) return;
    if (!sucursalId) return toast.error('Elige una sucursal');
    if (formaEntrega === 'domicilio' && !direccion.trim()) return toast.error('Escribe la dirección de entrega');
    if (!nombre.trim() || !telefono.trim() || !correo.trim()) return toast.error('Completa tus datos de contacto');
    pagar.mutate();
  }

  return (
    <div className="min-h-screen bg-tienda-surface font-tienda text-tienda-ink">
      <header className="sticky top-0 z-10 bg-gradient-to-b from-tienda-tealsoft to-tienda-surface border-b border-tienda-teal/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/tienda" className="text-tienda-teal hover:text-tienda-teal/70 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="font-tienda-display text-lg font-extrabold text-tienda-ink tracking-tight flex-1">
            Tu carrito
          </h1>
          {token ? (
            <button type="button" onClick={logout} className="text-xs text-tienda-muted hover:text-tienda-teal flex items-center gap-1">
              <User size={13} /> {cliente?.nombre?.split(' ')[0] || 'Mi cuenta'} · Salir
            </button>
          ) : (
            <Link to="/tienda/cuenta" className="text-xs text-tienda-teal font-medium hover:underline flex items-center gap-1">
              <User size={13} /> Iniciar sesión
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {!items.length ? (
          <div className="text-center py-16">
            <ShoppingBag size={40} className="mx-auto text-tienda-ink/15 mb-3" />
            <p className="text-tienda-muted">Tu carrito está vacío.</p>
            <Link to="/tienda" className="text-tienda-teal text-sm font-medium hover:underline mt-2 inline-block">
              Ver catálogo
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-tienda-ink/5 divide-y divide-tienda-ink/5 overflow-hidden">
              {items.map((it) => (
                <div key={it.producto_id} className="flex items-center gap-3 p-3">
                  <div className="w-14 h-14 rounded-xl bg-tienda-surface2 shrink-0 overflow-hidden flex items-center justify-center">
                    {it.imagen_url
                      ? <img src={`/uploads/productos/${it.imagen_url}`} alt="" className="w-full h-full object-cover" />
                      : <img src={info?.logo_url || '/logo_innovacom.png'} alt="" className="w-2/3 h-2/3 object-contain opacity-30" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-tienda-ink/90 line-clamp-2 leading-snug">{it.descripcion}</p>
                    <p className="text-sm font-tienda-display font-bold text-brand-600 mt-0.5">{money(it.precio_final)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" onClick={() => setCantidad(it.producto_id, it.cantidad - 1)}
                      className="w-7 h-7 flex items-center justify-center rounded-full ring-1 ring-tienda-ink/10 text-tienda-muted hover:bg-tienda-surface2">
                      <Minus size={13} />
                    </button>
                    <span className="w-6 text-center text-sm tabular-nums">{it.cantidad}</span>
                    <button type="button" onClick={() => setCantidad(it.producto_id, it.cantidad + 1)}
                      className="w-7 h-7 flex items-center justify-center rounded-full ring-1 ring-tienda-ink/10 text-tienda-muted hover:bg-tienda-surface2">
                      <Plus size={13} />
                    </button>
                  </div>
                  <button type="button" onClick={() => quitar(it.producto_id)}
                    className="text-tienda-muted hover:text-red-500 shrink-0" title="Quitar">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-tienda-ink/5 p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">Sucursal</label>
                <select
                  className="w-full rounded-xl border border-tienda-ink/10 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-tienda-teal/30 focus:border-tienda-teal"
                  value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}
                >
                  <option value="">— Elegir sucursal —</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={() => setFormaEntrega('pickup')}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors
                    ${formaEntrega === 'pickup' ? 'bg-tienda-teal text-white' : 'ring-1 ring-tienda-ink/10 text-tienda-muted hover:bg-tienda-surface2'}`}>
                  <Store size={15} /> Recoger en sucursal
                </button>
                <button type="button" onClick={() => setFormaEntrega('domicilio')}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors
                    ${formaEntrega === 'domicilio' ? 'bg-tienda-teal text-white' : 'ring-1 ring-tienda-ink/10 text-tienda-muted hover:bg-tienda-surface2'}`}>
                  <Truck size={15} /> A domicilio
                </button>
              </div>
              {formaEntrega === 'domicilio' && (
                <div>
                  <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">Dirección de entrega</label>
                  <textarea rows={2} value={direccion} onChange={(e) => setDireccion(e.target.value)}
                    className="w-full rounded-xl border border-tienda-ink/10 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-tienda-teal/30 focus:border-tienda-teal"
                    placeholder="Calle, número, colonia, referencias" />
                  {envio > 0 && <p className="text-xs text-tienda-muted mt-1">Envío: {money(envio)}</p>}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">Nombre de quien recibe</label>
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)}
                    className="w-full rounded-xl border border-tienda-ink/10 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-tienda-teal/30 focus:border-tienda-teal" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">Teléfono</label>
                  <input value={telefono} onChange={(e) => setTelefono(e.target.value)}
                    className="w-full rounded-xl border border-tienda-ink/10 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-tienda-teal/30 focus:border-tienda-teal" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">Correo (para tu recibo)</label>
                <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)}
                  className="w-full rounded-xl border border-tienda-ink/10 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-tienda-teal/30 focus:border-tienda-teal" />
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-tienda-ink/5 p-4">
              <div className="flex items-baseline justify-between text-sm text-tienda-muted">
                <span>Subtotal</span><span className="tabular-nums">{money(subtotalAprox)}</span>
              </div>
              {envio > 0 && (
                <div className="flex items-baseline justify-between text-sm text-tienda-muted mt-1">
                  <span>Envío</span><span className="tabular-nums">{money(envio)}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between font-tienda-display font-extrabold text-lg text-tienda-ink mt-2 pt-2 border-t border-tienda-ink/5">
                <span>Total aproximado</span><span className="tabular-nums">{money(totalAprox)}</span>
              </div>
              <p className="text-[11px] text-tienda-muted mt-1">El precio final se confirma al pagar (incluye IVA).</p>

              <button
                type="button" disabled={pagar.isPending} onClick={irAPagar}
                className="mt-4 w-full flex items-center justify-center gap-2 bg-tienda-teal hover:bg-tienda-teal/90
                           text-white font-tienda-display font-bold px-4 py-3.5 rounded-2xl
                           shadow-[0_10px_24px_rgba(14,124,107,0.25)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
              >
                {pagar.isPending ? 'Redirigiendo…' : 'Pagar con tarjeta'}
              </button>
            </div>
          </div>
        )}
      </main>

      <TiendaFooter info={info} />
    </div>
  );
}
