// Catálogo público de la farmacia — SIN login (ver App.jsx: ruta fuera de
// RequireAuth). Entrega 1 del plan de tienda web (memoria
// project_tienda_web_farmacia): solo lectura + "Pedir por WhatsApp", que cae
// directo al carrito conversacional ya existente. No crea pedidos aquí.
//
// Identidad visual propia de /tienda (ver tailwind.config.js: paleta
// `tienda-*` + fuentes `font-tienda`/`font-tienda-display`), separada del
// look de panel administrativo que usa el resto del ERP. El color de marca
// del tenant (brand-*, white-label) se conserva para precio y CTA.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Package, MessageCircle, Pill, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { linkWhatsApp } from '../../utils/whatsapp';
import TiendaFooter from './TiendaFooter';
import CarritoBadge from './CarritoBadge';
import useTituloPagina from '../../hooks/useTituloPagina';
import { useTiendaCarrito } from '../../store/tiendaCarritoStore';

const PAGE_SIZE = 24;

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

function RxPill() {
  return (
    <span
      className="absolute top-2 left-2 flex items-center justify-center w-7 h-7 rounded-full
                 bg-tienda-ambersoft text-tienda-amber font-tienda-display text-[11px] font-extrabold
                 ring-1 ring-tienda-amber/20"
      title="Requiere receta médica"
    >
      Rx
    </span>
  );
}

export default function Catalogo() {
  const [busqueda, setBusqueda] = useState('');
  const [busquedaDeb, setBusquedaDeb] = useState('');
  const [familiaId, setFamiliaId] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [familiasAbiertas, setFamiliasAbiertas] = useState(() => new Set());
  const [offset, setOffset] = useState(0);
  const [acumulados, setAcumulados] = useState([]);
  const [catAbierta, setCatAbierta] = useState(true);
  const agregarAlCarrito = useTiendaCarrito((s) => s.agregar);

  useEffect(() => {
    const t = setTimeout(() => { setBusquedaDeb(busqueda); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => { setOffset(0); }, [familiaId, categoriaId]);

  function toggleFamilia(id) {
    setFamiliasAbiertas((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function elegirFamilia(id) {
    setFamiliaId(id);
    setCategoriaId('');
  }

  function elegirCategoria(famId, catId) {
    setFamiliaId(famId);
    setCategoriaId(catId);
  }

  const { data: info } = useQuery({
    queryKey: ['tienda-info'],
    queryFn: () => api.get('/tienda/info').then((r) => r.data),
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['tienda-categorias'],
    queryFn: () => api.get('/tienda/categorias').then((r) => r.data),
  });

  const { data, isFetching } = useQuery({
    queryKey: ['tienda-productos', busquedaDeb, familiaId, categoriaId, offset],
    queryFn: () => api.get('/tienda/productos', {
      params: {
        q: busquedaDeb || undefined,
        familia_id: familiaId || undefined,
        categoria_id: categoriaId || undefined,
        limit: PAGE_SIZE, offset,
      },
    }).then((r) => r.data),
    keepPreviousData: true,
  });

  useEffect(() => {
    if (!data) return;
    setAcumulados((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]));
  }, [data, offset]);

  const total = data?.total || 0;
  const hayMas = acumulados.length < total;
  // Sin foto propia: el logo de la empresa es el respaldo natural (mismo
  // tenant, siempre disponible); el PNG fijo queda solo si tampoco hay logo.
  const placeholder = info?.logo_url || '/logo_innovacom.png';

  useTituloPagina({
    titulo: info?.nombre ? `${info.nombre} — Farmacia en línea` : undefined,
    descripcion: info?.subtitulo,
  });

  return (
    <div className="min-h-screen bg-tienda-surface font-tienda text-tienda-ink">
      <header className="sticky top-0 z-10 bg-gradient-to-b from-tienda-tealsoft to-tienda-surface border-b border-tienda-teal/10">
        <div className="max-w-6xl mx-auto px-4 pt-6 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {info?.logo_url && (
                <img src={info.logo_url} alt="" className="h-11 w-11 sm:h-14 sm:w-14 object-contain shrink-0" />
              )}
              <div className="min-w-0">
                {info?.lema && (
                  <div className="flex items-center gap-1.5 text-tienda-teal text-xs font-semibold tracking-wide uppercase mb-1.5">
                    <Pill size={14} strokeWidth={2.5} />
                    {info.lema}
                  </div>
                )}
                <h1 className="font-tienda-display text-2xl sm:text-3xl font-extrabold text-tienda-ink tracking-tight">
                  {info?.nombre || 'Farmacia'}
                </h1>
              </div>
            </div>
            <CarritoBadge pagoHabilitado={info?.pago_habilitado} />
          </div>
          <p className="text-sm text-tienda-muted mt-2">
            {info?.subtitulo || 'Pide en línea, recibe por WhatsApp el mismo día.'}
          </p>

          <div className="relative mt-4">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-tienda-muted" />
            <input
              className="w-full rounded-2xl border border-tienda-ink/10 bg-white pl-10 pr-4 py-3 text-sm
                         shadow-sm placeholder-tienda-muted/70 focus:outline-none focus:ring-2
                         focus:ring-tienda-teal/30 focus:border-tienda-teal transition-shadow"
              placeholder="Buscar producto…"
              value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 flex items-start gap-4 sm:gap-5">
        <aside className={`shrink-0 sticky top-24 transition-all duration-200 ${catAbierta ? 'w-40 sm:w-52' : 'w-11'}`}>
          <div className="bg-white rounded-2xl border border-tienda-ink/5 shadow-[0_1px_2px_rgba(16,24,39,0.05)] overflow-hidden">
            <button
              onClick={() => setCatAbierta((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-3 text-sm font-semibold text-tienda-ink
                         hover:bg-tienda-surface2 transition-colors"
              title={catAbierta ? 'Contraer categorías' : 'Expandir categorías'}
            >
              {catAbierta ? <ChevronLeft size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
              {catAbierta && <span>Categorías</span>}
            </button>
            {catAbierta && categorias.length > 0 && (
              <nav className="flex flex-col gap-1 p-2 pt-0 max-h-[70vh] overflow-y-auto">
                <button
                  onClick={() => { setFamiliaId(''); setCategoriaId(''); }}
                  className={`text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    familiaId === '' ? 'bg-tienda-teal text-white' : 'text-tienda-muted hover:bg-tienda-surface2'
                  }`}
                >
                  Todas
                </button>
                {categorias.map((f) => {
                  const tieneSubs = f.categorias?.length > 0;
                  const abierta = familiasAbiertas.has(f.id);
                  const familiaActiva = String(familiaId) === String(f.id) && categoriaId === '';
                  return (
                    <div key={f.id}>
                      <div className={`flex items-center rounded-xl transition-colors ${
                        familiaActiva ? 'bg-tienda-teal text-white' : 'text-tienda-muted hover:bg-tienda-surface2'
                      }`}>
                        <button
                          onClick={() => elegirFamilia(f.id)}
                          className="flex-1 text-left px-3 py-2 text-sm font-medium truncate"
                        >
                          {f.nombre}
                        </button>
                        {tieneSubs && (
                          <button
                            onClick={() => toggleFamilia(f.id)}
                            className="px-2 py-2 shrink-0"
                            title={abierta ? 'Contraer subcategorías' : 'Expandir subcategorías'}
                          >
                            {abierta
                              ? <ChevronLeft size={14} className="rotate-90" />
                              : <ChevronRight size={14} />}
                          </button>
                        )}
                      </div>
                      {tieneSubs && abierta && (
                        <div className="flex flex-col gap-0.5 mt-0.5 ml-3 border-l border-tienda-ink/10 pl-2">
                          {f.categorias.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => elegirCategoria(f.id, c.id)}
                              className={`text-left px-2.5 py-1.5 rounded-lg text-xs font-medium truncate transition-colors ${
                                String(categoriaId) === String(c.id)
                                  ? 'bg-tienda-teal text-white'
                                  : 'text-tienda-muted hover:bg-tienda-surface2'
                              }`}
                            >
                              {c.nombre}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            )}
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          {!isFetching && acumulados.length === 0 ? (
            <div className="text-center py-20">
              <Package size={40} className="mx-auto text-tienda-ink/15 mb-3" />
              <p className="text-tienda-muted">No encontramos productos con esa búsqueda.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {acumulados.map((p) => (
                <Link
                  key={p.id}
                  to={`/tienda/${p.id}`}
                  className="group bg-white rounded-2xl border border-tienda-ink/5 overflow-hidden
                             shadow-[0_1px_2px_rgba(16,24,39,0.05)] hover:shadow-[0_10px_28px_rgba(14,124,107,0.14)]
                             hover:-translate-y-0.5 transition-all duration-200"
                >
                  <div className="relative aspect-square bg-tienda-surface2 flex items-center justify-center overflow-hidden">
                    {p.imagen_url
                      ? <img src={`/uploads/productos/${p.imagen_url}`} alt={p.descripcion}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = placeholder; e.currentTarget.className = 'w-2/3 h-2/3 object-contain opacity-30 m-auto'; }} />
                      : <img src={placeholder} alt={p.descripcion}
                          className="w-2/3 h-2/3 object-contain opacity-30" />}
                    {p.requiere_receta && <RxPill />}
                    {p.descuento_pct > 0 && (
                      <span className="absolute top-2 right-2 flex items-center justify-center px-2 py-1 rounded-full
                                        bg-tienda-teal text-white font-tienda-display text-[11px] font-extrabold">
                        -{p.descuento_pct}%
                      </span>
                    )}
                    {!p.disponible && (
                      <span className="absolute bottom-2 left-2 right-2 text-center text-[11px] font-medium
                                        text-white bg-tienda-ink/70 rounded-full py-0.5 backdrop-blur-sm">
                        Sin existencia
                      </span>
                    )}
                    {/* Solo venta libre entra al carrito con pago en línea — lo que
                        requiere receta se sigue pidiendo por WhatsApp, sin excepción. */}
                    {info?.pago_habilitado && !p.requiere_receta && p.disponible && (
                      <button
                        type="button"
                        title="Agregar al carrito"
                        onClick={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          agregarAlCarrito(p);
                          toast.success('Agregado al carrito');
                        }}
                        className="absolute bottom-2 right-2 flex items-center justify-center w-8 h-8 rounded-full
                                   bg-tienda-teal text-white shadow-md hover:bg-tienda-teal/90 transition-colors"
                      >
                        <Plus size={16} />
                      </button>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm text-tienda-ink/90 line-clamp-2 leading-snug min-h-[2.5em]">
                      {p.descripcion_corta || p.descripcion}
                    </p>
                    {p.precio_final != null && (
                      <div className="flex items-baseline gap-1.5 mt-1.5">
                        <p className="font-tienda-display font-extrabold text-brand-600 tabular-nums text-base">
                          {money(p.precio_final)}
                        </p>
                        {p.descuento_pct > 0 && (
                          <p className="text-xs text-tienda-muted line-through tabular-nums">
                            {money(p.precio_lista)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {hayMas && (
            <div className="text-center mt-8">
              <button
                className="px-6 py-2.5 rounded-full border border-tienda-teal/30 text-tienda-teal font-medium text-sm
                           hover:bg-tienda-tealsoft transition-colors disabled:opacity-50"
                disabled={isFetching} onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                {isFetching ? 'Cargando…' : 'Ver más productos'}
              </button>
            </div>
          )}
        </main>
      </div>

      {info?.whatsapp && (
        <a
          href={linkWhatsApp(info.whatsapp, 'Hola, quiero hacer un pedido.')}
          target="_blank" rel="noopener noreferrer"
          className="fixed bottom-5 right-5 flex items-center gap-2 bg-green-500 hover:bg-green-600
                     text-white font-tienda-display font-bold text-sm px-4 py-3 rounded-full
                     shadow-[0_10px_24px_rgba(34,197,94,0.35)] transition-transform hover:-translate-y-0.5"
        >
          <MessageCircle size={19} /> Pedir por WhatsApp
        </a>
      )}

      <TiendaFooter info={info} />
    </div>
  );
}
