// Perfil + historial de pedidos del cliente logueado — une los tres canales
// (mostrador, WhatsApp, tienda en línea) vía GET /tienda/cuenta/pedidos,
// mismo resolver que usa el staff en pos.clientesfidelidad.service#historial.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LogOut, Package, ChevronDown, ChevronUp, Store, MessageCircle, ShoppingBag } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/apiTienda';
import { useTiendaAuth } from '../../store/tiendaAuthStore';
import useTituloPagina from '../../hooks/useTituloPagina';

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

const ORIGEN = {
  mostrador: { label: 'Compra en sucursal', Icon: Store },
  whatsapp: { label: 'Pedido por WhatsApp', Icon: MessageCircle },
  tienda: { label: 'Pedido en línea', Icon: ShoppingBag },
};

const inputCls = 'w-full rounded-xl border border-tienda-ink/10 bg-white px-3 py-2.5 text-sm '
  + 'focus:outline-none focus:ring-2 focus:ring-tienda-teal/30 focus:border-tienda-teal';

export default function MiCuenta() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { token, cliente, logout, actualizarCliente } = useTiendaAuth();
  const [expandido, setExpandido] = useState(null); // `${origen}-${id}` o null
  const [editando, setEditando] = useState(false);

  useTituloPagina({ titulo: 'Mi cuenta' });

  useEffect(() => {
    if (!token) navigate('/tienda/cuenta', { replace: true });
  }, [token, navigate]);

  const { data: perfil } = useQuery({
    queryKey: ['tienda-cuenta-perfil'],
    queryFn: () => api.get('/tienda/cuenta/perfil').then((r) => r.data),
    enabled: !!token,
  });

  const { data: historial, isLoading } = useQuery({
    queryKey: ['tienda-cuenta-pedidos'],
    queryFn: () => api.get('/tienda/cuenta/pedidos').then((r) => r.data),
    enabled: !!token,
  });

  function cerrarSesion() {
    logout();
    qc.removeQueries({ queryKey: ['tienda-cuenta-perfil'] });
    qc.removeQueries({ queryKey: ['tienda-cuenta-pedidos'] });
    navigate('/tienda');
  }

  if (!token) return null;

  return (
    <div className="min-h-screen bg-tienda-surface font-tienda text-tienda-ink">
      <header className="sticky top-0 z-10 bg-gradient-to-b from-tienda-tealsoft to-tienda-surface border-b border-tienda-teal/10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/tienda" className="text-tienda-teal hover:text-tienda-teal/70 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="font-tienda-display text-lg font-extrabold text-tienda-ink tracking-tight flex-1">
            Hola, {cliente?.nombre?.split(' ')[0] || 'de nuevo'}
          </h1>
          <button type="button" onClick={cerrarSesion} className="text-xs text-tienda-muted hover:text-red-500 flex items-center gap-1">
            <LogOut size={14} /> Salir
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <section className="bg-white rounded-2xl border border-tienda-ink/5 p-5">
          {!editando ? (
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-tienda-display font-bold text-tienda-ink">{perfil?.nombre}</p>
                <p className="text-sm text-tienda-muted mt-0.5">{perfil?.telefono}</p>
                {perfil?.correo && <p className="text-sm text-tienda-muted">{perfil.correo}</p>}
                {perfil?.direccion_entrega && <p className="text-sm text-tienda-muted mt-1">{perfil.direccion_entrega}</p>}
              </div>
              <button type="button" onClick={() => setEditando(true)} className="text-xs text-tienda-teal font-medium hover:underline shrink-0">
                Editar
              </button>
            </div>
          ) : (
            <FormPerfil
              perfil={perfil}
              onCancelar={() => setEditando(false)}
              onGuardado={(nuevo) => { actualizarCliente({ ...cliente, nombre: nuevo.nombre }); setEditando(false); }}
            />
          )}
        </section>

        <section>
          <h2 className="font-tienda-display font-bold text-tienda-ink mb-3">Tus pedidos</h2>
          {isLoading && <p className="text-sm text-tienda-muted">Cargando…</p>}
          {!isLoading && !historial?.pedidos?.length && (
            <div className="text-center py-12 bg-white rounded-2xl border border-tienda-ink/5">
              <Package size={32} className="mx-auto text-tienda-ink/15 mb-2" />
              <p className="text-sm text-tienda-muted">Todavía no tienes pedidos.</p>
              <Link to="/tienda" className="text-tienda-teal text-sm font-medium hover:underline mt-2 inline-block">
                Ver catálogo
              </Link>
            </div>
          )}
          {historial?.resumen?.total_pedidos > 0 && (
            <p className="text-xs text-tienda-muted mb-3">
              {historial.resumen.total_pedidos} pedido{historial.resumen.total_pedidos === 1 ? '' : 's'} · Total comprado: {money(historial.resumen.importe_total)}
            </p>
          )}
          <div className="space-y-2">
            {historial?.pedidos?.map((p) => {
              const key = `${p.origen}-${p.id}`;
              const { label, Icon } = ORIGEN[p.origen] || { label: p.origen, Icon: Package };
              const abierto = expandido === key;
              return (
                <div key={key} className="bg-white rounded-2xl border border-tienda-ink/5 overflow-hidden">
                  <button
                    type="button" onClick={() => setExpandido(abierto ? null : key)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-tienda-surface2 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-full bg-tienda-tealsoft text-tienda-teal flex items-center justify-center shrink-0">
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-tienda-ink truncate">{label} · {p.folio}</p>
                      <p className="text-xs text-tienda-muted mt-0.5">
                        {new Date(p.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}<span className="capitalize">{p.estatus.replace('_', ' ')}</span>
                      </p>
                    </div>
                    <p className="font-tienda-display font-bold text-tienda-ink shrink-0">{money(p.total)}</p>
                    {abierto ? <ChevronUp size={16} className="text-tienda-muted shrink-0" /> : <ChevronDown size={16} className="text-tienda-muted shrink-0" />}
                  </button>
                  {abierto && <DetallePedido origen={p.origen} id={p.id} />}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

function DetallePedido({ origen, id }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tienda-cuenta-pedido', origen, id],
    queryFn: () => api.get(`/tienda/cuenta/pedidos/${origen}/${id}`).then((r) => r.data),
  });

  if (isLoading) return <p className="text-xs text-tienda-muted px-4 pb-4">Cargando…</p>;
  if (!data) return null;

  return (
    <div className="border-t border-tienda-ink/5 px-4 py-3 space-y-1.5">
      {(data.partidas || []).map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-tienda-ink/80">{Number(p.cantidad)} × {p.descripcion}</span>
          <span className="text-tienda-muted tabular-nums shrink-0">{money(p.importe)}</span>
        </div>
      ))}
    </div>
  );
}

function FormPerfil({ perfil, onCancelar, onGuardado }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState(perfil?.nombre || '');
  const [correo, setCorreo] = useState(perfil?.correo || '');
  const [direccion, setDireccion] = useState(perfil?.direccion_entrega || '');

  const guardar = useMutation({
    mutationFn: () => api.put('/tienda/cuenta/perfil', {
      nombre: nombre.trim(), correo: correo.trim() || undefined, direccion_entrega: direccion.trim() || undefined,
    }).then((r) => r.data),
    onSuccess: (data) => {
      toast.success('Datos actualizados');
      qc.setQueryData(['tienda-cuenta-perfil'], data);
      onGuardado(data);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo guardar'),
  });

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">Nombre</label>
        <input className={inputCls} value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">Correo</label>
        <input type="email" className={inputCls} value={correo} onChange={(e) => setCorreo(e.target.value)} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">Dirección de entrega habitual</label>
        <textarea rows={2} className={inputCls} value={direccion} onChange={(e) => setDireccion(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancelar} className="px-4 py-2 text-sm text-tienda-muted hover:text-tienda-ink">
          Cancelar
        </button>
        <button
          type="button" disabled={!nombre.trim() || guardar.isPending} onClick={() => guardar.mutate()}
          className="px-4 py-2 rounded-xl bg-tienda-teal hover:bg-tienda-teal/90 text-white text-sm font-medium disabled:opacity-50"
        >
          {guardar.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
