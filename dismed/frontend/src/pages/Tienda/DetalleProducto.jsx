// Ficha de producto del catálogo público — misma identidad visual que
// Catalogo.jsx (paleta `tienda-*` + fuentes `font-tienda*`, ver tailwind.config.js).
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Package, MessageCircle, ShoppingCart } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { linkWhatsApp } from '../../utils/whatsapp';
import TiendaFooter from './TiendaFooter';
import CarritoBadge from './CarritoBadge';
import useTituloPagina from '../../hooks/useTituloPagina';
import { useTiendaCarrito } from '../../store/tiendaCarritoStore';

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export default function DetalleProducto() {
  const { id } = useParams();
  const agregarAlCarrito = useTiendaCarrito((s) => s.agregar);

  const { data: info } = useQuery({
    queryKey: ['tienda-info'],
    queryFn: () => api.get('/tienda/info').then((r) => r.data),
  });

  const { data: p, isLoading, isError } = useQuery({
    queryKey: ['tienda-producto', id],
    queryFn: () => api.get(`/tienda/productos/${id}`).then((r) => r.data),
  });

  const ficha = p && [
    ['Fabricante', p.fabricante],
    ['Sustancia activa', p.sustancia_activa],
    ['Tamaño', p.tamano],
    ['Calibre', p.calibre],
    ['Especificación', p.especificacion],
    ['Código de barras', p.ean],
  ].filter(([, v]) => v);

  const mensajeWa = p ? `Hola, quiero pedir: ${p.descripcion}` : '';
  // Sin foto propia: el logo de la empresa es el respaldo natural (mismo
  // tenant, siempre disponible); el PNG fijo queda solo si tampoco hay logo.
  const placeholder = info?.logo_url || '/logo_innovacom.png';

  useTituloPagina({
    titulo: p ? `${p.descripcion} · ${info?.nombre || 'Farmacia'}` : undefined,
    descripcion: p?.descripcion_corta || (p?.descripcion ? p.descripcion.slice(0, 150) : undefined),
  });

  return (
    <div className="min-h-screen bg-tienda-surface font-tienda text-tienda-ink">
      <header className="sticky top-0 z-10 bg-gradient-to-b from-tienda-tealsoft to-tienda-surface border-b border-tienda-teal/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/tienda" className="text-tienda-teal hover:text-tienda-teal/70 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          {info?.logo_url && <img src={info.logo_url} alt="" className="h-8 w-8 object-contain shrink-0" />}
          <h1 className="font-tienda-display text-lg font-extrabold text-tienda-ink tracking-tight flex-1 min-w-0 truncate">
            {info?.nombre || 'Farmacia'}
          </h1>
          <CarritoBadge pagoHabilitado={info?.pago_habilitado} />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {isLoading && <p className="text-sm text-tienda-muted text-center py-16">Cargando…</p>}
        {isError && (
          <div className="text-center py-16">
            <Package size={40} className="mx-auto text-tienda-ink/15 mb-3" />
            <p className="text-tienda-muted">No encontramos este producto.</p>
            <Link to="/tienda" className="text-tienda-teal text-sm font-medium hover:underline mt-2 inline-block">
              Volver al catálogo
            </Link>
          </div>
        )}

        {p && (
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="aspect-square bg-white rounded-2xl border border-tienda-ink/5 flex items-center
                             justify-center overflow-hidden shadow-[0_1px_2px_rgba(16,24,39,0.05)]">
              {p.imagen_url
                ? <img src={`/uploads/productos/${p.imagen_url}`} alt={p.descripcion} className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = placeholder; e.currentTarget.className = 'w-1/2 h-1/2 object-contain opacity-30 m-auto'; }} />
                : <img src={placeholder} alt={p.descripcion} className="w-1/2 h-1/2 object-contain opacity-30" />}
            </div>

            <div>
              <p className="text-xs text-tienda-muted uppercase tracking-wide font-medium">
                {p.familia_nombre}{p.categoria_nombre ? ` · ${p.categoria_nombre}` : ''}
              </p>
              <h2 className="font-tienda-display text-2xl font-extrabold text-tienda-ink mt-1 tracking-tight">
                {p.descripcion}
              </h2>
              {p.descripcion_corta && <p className="text-sm text-tienda-muted mt-1">{p.descripcion_corta}</p>}

              {p.precio_final != null && (
                <div className="flex items-baseline gap-2 mt-4">
                  <p className="font-tienda-display text-3xl font-extrabold text-brand-600 tabular-nums">
                    {money(p.precio_final)}
                  </p>
                  {p.descuento_pct > 0 && (
                    <>
                      <p className="text-base text-tienda-muted line-through tabular-nums">
                        {money(p.precio_lista)}
                      </p>
                      <span className="px-2 py-0.5 rounded-full bg-tienda-teal text-white font-tienda-display text-xs font-extrabold">
                        -{p.descuento_pct}%
                      </span>
                    </>
                  )}
                </div>
              )}

              <div className="flex gap-2 mt-3 flex-wrap">
                {p.disponible
                  ? <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-tienda-tealsoft text-tienda-teal">
                      Disponible
                    </span>
                  : <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-tienda-ink/5 text-tienda-muted">
                      Sin existencia por el momento
                    </span>}
                {p.requiere_receta && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-tienda-ambersoft text-tienda-amber">
                    <span className="font-tienda-display font-extrabold">Rx</span> Requiere receta médica
                  </span>
                )}
              </div>

              {/* Solo venta libre entra al carrito con pago en línea — lo que
                  requiere receta se sigue pidiendo por WhatsApp, sin excepción. */}
              {info?.pago_habilitado && !p.requiere_receta && p.disponible && (
                <button
                  type="button"
                  onClick={() => { agregarAlCarrito(p); toast.success('Agregado al carrito'); }}
                  className="mt-6 flex items-center justify-center gap-2 bg-tienda-teal hover:bg-tienda-teal/90
                             text-white font-tienda-display font-bold px-4 py-3.5 rounded-2xl w-full
                             shadow-[0_10px_24px_rgba(14,124,107,0.25)] transition-transform hover:-translate-y-0.5"
                >
                  <ShoppingCart size={20} /> Agregar al carrito
                </button>
              )}

              {info?.whatsapp ? (
                <a
                  href={linkWhatsApp(info.whatsapp, mensajeWa)}
                  target="_blank" rel="noopener noreferrer"
                  className="mt-6 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600
                             text-white font-tienda-display font-bold px-4 py-3.5 rounded-2xl w-full
                             shadow-[0_10px_24px_rgba(34,197,94,0.3)] transition-transform hover:-translate-y-0.5"
                >
                  <MessageCircle size={20} /> Pedir por WhatsApp
                </a>
              ) : (
                <p className="text-xs text-tienda-muted mt-6">Por el momento no está disponible el pedido por WhatsApp.</p>
              )}
              {p.requiere_receta && (
                <p className="text-xs text-tienda-muted mt-2">
                  Te pediremos una foto de tu receta por WhatsApp para poder surtir este producto.
                </p>
              )}

              {ficha?.length > 0 && (
                <div className="border-t border-tienda-ink/10 mt-6 pt-4">
                  <p className="text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">Ficha del producto</p>
                  <dl className="text-sm space-y-1.5">
                    {ficha.map(([label, valor]) => (
                      <div key={label} className="flex gap-2">
                        <dt className="text-tienda-muted w-40 shrink-0">{label}</dt>
                        <dd className="text-tienda-ink/90">{valor}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <TiendaFooter info={info} />
    </div>
  );
}
