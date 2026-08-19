// Página compartida para /tienda/privacidad y /tienda/terminos — mismo header
// compacto y mismo tratamiento de "no encontrado" que DetalleProducto.jsx.
// El texto viene de empresas_config (branding.service.js#CONFIG_META, grupo
// 'legal') vía GET /tienda/legal?tipo=... — separado de /tienda/info porque
// es texto largo que solo necesitan estas dos páginas.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText } from 'lucide-react';
import api from '../../services/apiTienda';
import TiendaFooter from './TiendaFooter';
import useTituloPagina from '../../hooks/useTituloPagina';

export default function PaginaLegal({ tipo }) {
  const { data: info } = useQuery({
    queryKey: ['tienda-info'],
    queryFn: () => api.get('/tienda/info').then((r) => r.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['tienda-legal', tipo],
    queryFn: () => api.get('/tienda/legal', { params: { tipo } }).then((r) => r.data),
  });

  const parrafos = (data?.texto || '').split('\n\n').filter(Boolean);

  useTituloPagina({
    titulo: data?.titulo ? `${data.titulo} · ${info?.nombre || 'Farmacia'}` : undefined,
  });

  return (
    <div className="min-h-screen bg-tienda-surface font-tienda text-tienda-ink">
      <header className="sticky top-0 z-10 bg-gradient-to-b from-tienda-tealsoft to-tienda-surface border-b border-tienda-teal/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/tienda" className="text-tienda-teal hover:text-tienda-teal/70 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          {info?.logo_url && <img src={info.logo_url} alt="" className="h-8 w-8 object-contain shrink-0" />}
          <h1 className="font-tienda-display text-lg font-extrabold text-tienda-ink tracking-tight">
            {info?.nombre || 'Farmacia'}
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {isLoading && <p className="text-sm text-tienda-muted text-center py-16">Cargando…</p>}

        {!isLoading && parrafos.length === 0 && (
          <div className="text-center py-16">
            <FileText size={40} className="mx-auto text-tienda-ink/15 mb-3" />
            <p className="text-tienda-muted">Todavía no está disponible.</p>
            <Link to="/tienda" className="text-tienda-teal text-sm font-medium hover:underline mt-2 inline-block">
              Volver al catálogo
            </Link>
          </div>
        )}

        {!isLoading && parrafos.length > 0 && (
          <article>
            <h2 className="font-tienda-display text-2xl font-extrabold text-tienda-ink tracking-tight mb-4">
              {data.titulo}
            </h2>
            <div className="space-y-4 text-sm text-tienda-ink/90 leading-relaxed">
              {parrafos.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </article>
        )}
      </main>

      <TiendaFooter info={info} />
    </div>
  );
}
