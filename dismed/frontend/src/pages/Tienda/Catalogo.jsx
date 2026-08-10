// Catálogo público de la farmacia — SIN login (ver App.jsx: ruta fuera de
// RequireAuth). Entrega 1 del plan de tienda web (memoria
// project_tienda_web_farmacia): solo lectura + "Pedir por WhatsApp", que cae
// directo al carrito conversacional ya existente. No crea pedidos aquí.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Package, MessageCircle } from 'lucide-react';
import api from '../../services/api';
import { linkWhatsApp } from '../../utils/whatsapp';

const PAGE_SIZE = 24;

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export default function Catalogo() {
  const [busqueda, setBusqueda] = useState('');
  const [busquedaDeb, setBusquedaDeb] = useState('');
  const [familiaId, setFamiliaId] = useState('');
  const [offset, setOffset] = useState(0);
  const [acumulados, setAcumulados] = useState([]);

  useEffect(() => {
    const t = setTimeout(() => { setBusquedaDeb(busqueda); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => { setOffset(0); }, [familiaId]);

  const { data: info } = useQuery({
    queryKey: ['tienda-info'],
    queryFn: () => api.get('/tienda/info').then((r) => r.data),
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['tienda-categorias'],
    queryFn: () => api.get('/tienda/categorias').then((r) => r.data),
  });

  const { data, isFetching } = useQuery({
    queryKey: ['tienda-productos', busquedaDeb, familiaId, offset],
    queryFn: () => api.get('/tienda/productos', {
      params: { q: busquedaDeb || undefined, familia_id: familiaId || undefined, limit: PAGE_SIZE, offset },
    }).then((r) => r.data),
    keepPreviousData: true,
  });

  useEffect(() => {
    if (!data) return;
    setAcumulados((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]));
  }, [data, offset]);

  const total = data?.total || 0;
  const hayMas = acumulados.length < total;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">{info?.nombre || 'Farmacia'}</h1>
          <p className="text-sm text-gray-400">Catálogo de productos</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex gap-3 mb-5 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9 w-full" placeholder="Buscar producto…"
              value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
          <select className="input w-56" value={familiaId} onChange={(e) => setFamiliaId(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>

        {!isFetching && acumulados.length === 0 ? (
          <div className="text-center py-16">
            <Package size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">No encontramos productos con esa búsqueda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {acumulados.map((p) => (
              <Link key={p.id} to={`/tienda/${p.id}`} className="card hover:shadow-md transition-shadow overflow-hidden">
                <div className="aspect-square bg-gray-100 rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                  {p.imagen_url
                    ? <img src={`/uploads/productos/${p.imagen_url}`} alt={p.descripcion} className="w-full h-full object-cover" />
                    : <Package size={32} className="text-gray-300" />}
                </div>
                <p className="text-sm font-medium text-gray-900 line-clamp-2">{p.descripcion_corta || p.descripcion}</p>
                {p.precio_publico != null && (
                  <p className="text-base font-bold text-brand-600 mt-1">{money(p.precio_publico)}</p>
                )}
                <div className="flex gap-1 mt-1 flex-wrap">
                  {!p.disponible && <span className="badge-gray">Sin existencia</span>}
                  {p.requiere_receta && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Requiere receta</span>}
                </div>
              </Link>
            ))}
          </div>
        )}

        {hayMas && (
          <div className="text-center mt-6">
            <button className="btn-secondary" disabled={isFetching} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
              {isFetching ? 'Cargando…' : 'Ver más productos'}
            </button>
          </div>
        )}
      </main>

      {info?.whatsapp && (
        <a
          href={linkWhatsApp(info.whatsapp, 'Hola, quiero hacer un pedido.')}
          target="_blank" rel="noopener noreferrer"
          className="fixed bottom-5 right-5 flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-medium px-4 py-3 rounded-full shadow-lg"
        >
          <MessageCircle size={20} /> Pedir por WhatsApp
        </a>
      )}
    </div>
  );
}
