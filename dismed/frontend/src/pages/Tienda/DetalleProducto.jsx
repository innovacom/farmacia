import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Package, MessageCircle } from 'lucide-react';
import api from '../../services/api';
import { linkWhatsApp } from '../../utils/whatsapp';

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export default function DetalleProducto() {
  const { id } = useParams();

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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/tienda" className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></Link>
          <h1 className="text-lg font-bold text-gray-900">{info?.nombre || 'Farmacia'}</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {isLoading && <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>}
        {isError && (
          <div className="text-center py-16">
            <Package size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">No encontramos este producto.</p>
            <Link to="/tienda" className="text-brand-500 text-sm hover:underline mt-2 inline-block">Volver al catálogo</Link>
          </div>
        )}

        {p && (
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="aspect-square bg-gray-100 rounded-xl flex items-center justify-center overflow-hidden">
              {p.imagen_url
                ? <img src={`/uploads/productos/${p.imagen_url}`} alt={p.descripcion} className="w-full h-full object-cover" />
                : <Package size={56} className="text-gray-300" />}
            </div>

            <div>
              <p className="text-xs text-gray-400">{p.familia_nombre}{p.categoria_nombre ? ` · ${p.categoria_nombre}` : ''}</p>
              <h2 className="text-2xl font-bold text-gray-900 mt-1">{p.descripcion}</h2>
              {p.descripcion_corta && <p className="text-sm text-gray-500 mt-1">{p.descripcion_corta}</p>}

              {p.precio_publico != null && (
                <p className="text-3xl font-bold text-brand-600 mt-4">{money(p.precio_publico)}</p>
              )}

              <div className="flex gap-2 mt-3 flex-wrap">
                {p.disponible
                  ? <span className="badge-green">Disponible</span>
                  : <span className="badge-gray">Sin existencia por el momento</span>}
                {p.requiere_receta && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Requiere receta médica</span>
                )}
              </div>

              {info?.whatsapp ? (
                <a
                  href={linkWhatsApp(info.whatsapp, mensajeWa)}
                  target="_blank" rel="noopener noreferrer"
                  className="mt-6 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-medium px-4 py-3 rounded-xl w-full"
                >
                  <MessageCircle size={20} /> Pedir por WhatsApp
                </a>
              ) : (
                <p className="text-xs text-gray-400 mt-6">Por el momento no está disponible el pedido por WhatsApp.</p>
              )}
              {p.requiere_receta && (
                <p className="text-xs text-gray-400 mt-2">Te pediremos una foto de tu receta por WhatsApp para poder surtir este producto.</p>
              )}

              {ficha?.length > 0 && (
                <div className="border-t border-gray-100 mt-6 pt-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ficha del producto</p>
                  <dl className="text-sm space-y-1">
                    {ficha.map(([label, valor]) => (
                      <div key={label} className="flex gap-2">
                        <dt className="text-gray-400 w-40 shrink-0">{label}</dt>
                        <dd className="text-gray-700">{valor}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
