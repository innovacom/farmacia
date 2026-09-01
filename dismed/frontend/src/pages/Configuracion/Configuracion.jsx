import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal, Check, Loader2, ShieldCheck, Save, Clock, MessageCircle, Truck, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { usePrefsStore, ROWS_PER_PAGE_OPTIONS } from '../../store/prefsStore';
import { usePermisos } from '../../hooks/usePermisos';
import { PERMISSION_GROUPS, PERMISSIONABLE_ITEMS } from '../../config/menu';
import api from '../../services/api';

export default function Configuracion() {
  const { isAdmin } = usePermisos();
  const rowsPerPage = usePrefsStore((s) => s.rowsPerPage);
  const setRowsPerPage = usePrefsStore((s) => s.setRowsPerPage);

  function pick(n) {
    setRowsPerPage(n);
    toast.success(`Ahora se muestran ${n} renglones por página`);
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-6">
        <SlidersHorizontal size={22} className="text-brand-500" />
        <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
      </div>

      {/* Preferencias del usuario */}
      <div className="card">
        <h2 className="font-semibold text-gray-900">Renglones por página</h2>
        <p className="text-sm text-gray-500 mt-1 mb-4">
          Cantidad de filas que se muestran en las tablas de listados (solicitudes,
          cotizaciones, pedidos, existencias, etc.).
        </p>

        <div className="flex flex-wrap gap-2">
          {ROWS_PER_PAGE_OPTIONS.map((n) => {
            const active = n === rowsPerPage;
            return (
              <button
                key={n}
                onClick={() => pick(n)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors
                  ${active
                    ? 'bg-brand-50 border-brand-500 text-brand-500'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {active && <Check size={15} />}
                {n}
              </button>
            );
          })}
        </div>
      </div>

      {/* Vigencia de precios (solo admin) */}
      {isAdmin && <VigenciaPrecios />}

      {/* Radio de cobertura a domicilio (solo admin) */}
      {isAdmin && <RadioCobertura />}

      {/* WhatsApp API (recordatorio de citas, solo admin) */}
      {isAdmin && <WhatsAppEstado />}

      {/* Pedido automático a Nadro (solo admin) */}
      {isAdmin && <PedidoNadro />}

      {/* Permisos por usuario (solo admin) */}
      {isAdmin && <PermisosUsuarios />}
    </div>
  );
}

function VigenciaPrecios() {
  const qc = useQueryClient();
  const [cat, setCat] = useState('');
  const [web, setWeb] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get('/configuracion').then((r) => r.data),
  });

  useEffect(() => {
    if (data) {
      setCat(String(data.vigencia_catalogo_meses ?? ''));
      setWeb(String(data.vigencia_web_meses ?? ''));
    }
  }, [data]);

  const guardar = useMutation({
    mutationFn: () => api.put('/configuracion', {
      vigencia_catalogo_meses: Number(cat),
      vigencia_web_meses: Number(web),
    }),
    onSuccess: (r) => {
      toast.success('Vigencia de precios actualizada');
      qc.setQueryData(['configuracion'], r.data);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo guardar'),
  });

  const valido = (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 120;
  const puedeGuardar = valido(cat) && valido(web) && !guardar.isPending;

  return (
    <div className="card mt-6">
      <div className="flex items-center gap-2 mb-1">
        <Clock size={18} className="text-brand-500" />
        <h2 className="font-semibold text-gray-900">Vigencia de precios</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Cuántos meses se considera válido un precio antes de volver a buscarlo. Si la antigüedad
        del precio supera el valor, el sistema vuelve a buscar el precio del producto.
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-4">Cargando…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Catálogo de proveedores</span>
              <p className="text-xs text-gray-400 mb-1.5">Precios cargados del tarifario del proveedor</p>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="1" max="120" value={cat}
                  onChange={(e) => setCat(e.target.value)}
                  className="input w-24 text-right tabular-nums"
                />
                <span className="text-sm text-gray-500">meses</span>
              </div>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Búsquedas web (internet)</span>
              <p className="text-xs text-gray-400 mb-1.5">Precios guardados de búsquedas previas en internet</p>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="1" max="120" value={web}
                  onChange={(e) => setWeb(e.target.value)}
                  className="input w-24 text-right tabular-nums"
                />
                <span className="text-sm text-gray-500">meses</span>
              </div>
            </label>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <button onClick={() => guardar.mutate()} disabled={!puedeGuardar} className="btn-primary">
              {guardar.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Guardar
            </button>
            <span className="text-xs text-gray-400">Valores permitidos: 1 a 120 meses.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RadioCobertura() {
  const qc = useQueryClient();
  const [radio, setRadio] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get('/configuracion').then((r) => r.data),
  });

  useEffect(() => {
    if (data) setRadio(String(data.radio_cobertura_km ?? ''));
  }, [data]);

  const guardar = useMutation({
    mutationFn: () => api.put('/configuracion', { radio_cobertura_km: Number(radio) }),
    onSuccess: (r) => {
      toast.success('Radio de cobertura actualizado');
      qc.setQueryData(['configuracion'], r.data);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo guardar'),
  });

  const valido = Number.isFinite(Number(radio)) && Number(radio) >= 0.1 && Number(radio) <= 50;
  const puedeGuardar = valido && !guardar.isPending;

  return (
    <div className="card mt-6">
      <div className="flex items-center gap-2 mb-1">
        <MapPin size={18} className="text-brand-500" />
        <h2 className="font-semibold text-gray-900">Radio de cobertura a domicilio</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Distancia máxima (línea recta desde la sucursal) para aceptar un pedido a domicilio por
        WhatsApp o desde la tienda en línea. Si la dirección del cliente está fuera de este radio,
        se le avisa y se le ofrece recoger en tienda. Requiere que la sucursal tenga sus
        coordenadas cargadas (Pos → Sucursales) y la variable de entorno GOOGLE_MAPS_API_KEY
        configurada en el servidor; sin alguna de las dos, esta validación se omite y el pedido
        sigue su curso normal.
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-4">Cargando…</p>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Radio de cobertura</span>
            <div className="flex items-center gap-2 mt-1.5">
              <input
                type="number" min="0.1" max="50" step="0.1" value={radio}
                onChange={(e) => setRadio(e.target.value)}
                className="input w-24 text-right tabular-nums"
              />
              <span className="text-sm text-gray-500">km</span>
            </div>
          </label>

          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <button onClick={() => guardar.mutate()} disabled={!puedeGuardar} className="btn-primary">
              {guardar.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Guardar
            </button>
            <span className="text-xs text-gray-400">Valores permitidos: 0.1 a 50 km.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Solo lectura: la configuración real (token, WABA ID, plantilla) se pone en
// el .env del backend y se activa desde la propia consola de Meta — ver
// src/modules/whatsapp/README.md. Aquí solo se confirma si ya quedó activa.
function WhatsAppEstado() {
  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-estado'],
    queryFn: () => api.get('/whatsapp/estado').then((r) => r.data),
  });

  return (
    <div className="card mt-6">
      <div className="flex items-center gap-2 mb-1">
        <MessageCircle size={18} className="text-brand-500" />
        <h2 className="font-semibold text-gray-900">WhatsApp API (recordatorio de citas)</h2>
      </div>
      <p className="text-sm text-gray-500 mb-3">
        Envío automático del recordatorio de citas y recepción de la respuesta del paciente
        (confirmar/reprogramar/cancelar) vía WhatsApp Cloud API. Se configura con variables de
        entorno en el servidor — ver <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
        src/modules/whatsapp/README.md</code> en el backend.
      </p>
      {isLoading ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : data?.configurado ? (
        <span className="badge-green">Configurado — el envío automático está activo</span>
      ) : (
        <span className="badge-yellow">Sin configurar — Citas usa por ahora el enlace manual de WhatsApp</span>
      )}
    </div>
  );
}

// Prende/apaga el cron de las 21:00 que arma y coloca el pedido de reposición
// a Nadro con lo vendido en el día. Cambia de inmediato (la BD, no el .env)
// — no requiere redeploy ni reiniciar el backend.
function PedidoNadro() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['nadro-config'],
    queryFn: () => api.get('/nadro/config').then((r) => r.data),
  });

  const guardar = useMutation({
    mutationFn: (activo) => api.put('/nadro/config', { activo }),
    onSuccess: (r) => {
      toast.success(r.data.activo ? 'Pedido automático a Nadro activado' : 'Pedido automático a Nadro apagado');
      qc.setQueryData(['nadro-config'], r.data);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo guardar'),
  });

  const activo = !!data?.activo;

  return (
    <div className="card mt-6">
      <div className="flex items-center gap-2 mb-1">
        <Truck size={18} className="text-brand-500" />
        <h2 className="font-semibold text-gray-900">Pedido automático a Nadro</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Cada noche a las 21:00 arma un pedido con lo vendido en el día (productos con proveedor
        Nadro confirmado en el catálogo) y lo coloca directamente en i22.nadro.mx — es dinero real
        contra la línea de crédito. Apágalo si ya se hizo el pedido manualmente o si quieres
        pausarlo por cualquier motivo.
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-2">Cargando…</p>
      ) : (
        <label className="flex items-center gap-3 cursor-pointer w-fit">
          <button
            type="button"
            role="switch"
            aria-checked={activo}
            disabled={guardar.isPending}
            onClick={() => guardar.mutate(!activo)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors
              ${activo ? 'bg-brand-500' : 'bg-gray-300'} ${guardar.isPending ? 'opacity-60' : ''}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
              ${activo ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <span className={`text-sm font-medium ${activo ? 'text-brand-600' : 'text-gray-500'}`}>
            {activo ? 'Activo — corre esta noche a las 21:00' : 'Apagado — no se pedirá nada automáticamente'}
          </span>
        </label>
      )}
    </div>
  );
}

const ALL_KEYS = PERMISSIONABLE_ITEMS.map((i) => i.key);

function PermisosUsuarios() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [checks, setChecks] = useState({}); // menu_key -> bool

  // Operadores (a los admin no se les configura: ven todo).
  const { data: usuarios = [] } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => api.get('/usuarios').then((r) => r.data),
  });
  const operadores = usuarios.filter((u) => u.rol !== 'admin' && u.activo);

  const { data: permisosUser, isFetching } = useQuery({
    queryKey: ['permisos-usuario', userId],
    enabled: !!userId,
    queryFn: () => api.get(`/usuarios/${userId}/permisos`).then((r) => r.data),
  });

  // Cargar los checks cuando llegan los permisos del usuario elegido.
  useEffect(() => {
    if (!userId) { setChecks({}); return; }
    if (permisosUser) {
      const m = {};
      ALL_KEYS.forEach((k) => { m[k] = permisosUser.includes(k); });
      setChecks(m);
    }
  }, [permisosUser, userId]);

  const guardar = useMutation({
    mutationFn: () => api.put(`/usuarios/${userId}/permisos`,
      { permisos: ALL_KEYS.filter((k) => checks[k]) }),
    onSuccess: () => {
      toast.success('Permisos actualizados');
      qc.invalidateQueries({ queryKey: ['permisos-usuario', userId] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo guardar'),
  });

  const toggle = (k) => setChecks((c) => ({ ...c, [k]: !c[k] }));
  const setGrupo = (items, val) =>
    setChecks((c) => ({ ...c, ...Object.fromEntries(items.map((i) => [i.key, val])) }));
  const setTodo = (val) =>
    setChecks(Object.fromEntries(ALL_KEYS.map((k) => [k, val])));

  return (
    <div className="card mt-6">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={18} className="text-brand-500" />
        <h2 className="font-semibold text-gray-900">Permisos de acceso (operadores)</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Elige un operador y marca a qué secciones del menú puede acceder. Los administradores
        siempre tienen acceso completo.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select className="input w-72" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">— Selecciona un operador —</option>
          {operadores.map((u) => (
            <option key={u.id} value={u.id}>{u.nombre}{u.puesto ? ` — ${u.puesto}` : ''}</option>
          ))}
        </select>
        {userId && (
          <div className="flex gap-2 text-xs">
            <button onClick={() => setTodo(true)} className="text-brand-500 hover:underline">Marcar todo</button>
            <span className="text-gray-300">·</span>
            <button onClick={() => setTodo(false)} className="text-brand-500 hover:underline">Quitar todo</button>
          </div>
        )}
      </div>

      {!userId ? (
        <p className="text-sm text-gray-400 py-6 text-center">Selecciona un operador para configurar sus accesos.</p>
      ) : isFetching && !permisosUser ? (
        <p className="text-sm text-gray-400 py-6 text-center">Cargando permisos…</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
            {PERMISSION_GROUPS.map((g) => {
              const todos = g.items.every((i) => checks[i.key]);
              return (
                <div key={g.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{g.label}</p>
                    <button
                      onClick={() => setGrupo(g.items, !todos)}
                      className="text-[11px] text-brand-500 hover:underline">
                      {todos ? 'Ninguno' : 'Todos'}
                    </button>
                  </div>
                  <div className="space-y-1">
                    {g.items.map((it) => (
                      <label key={it.key} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-500"
                          checked={!!checks[it.key]}
                          onChange={() => toggle(it.key)}
                        />
                        <it.icon size={15} className="text-gray-400" />
                        {it.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 mt-6 pt-4 border-t border-gray-100">
            <button onClick={() => guardar.mutate()} disabled={guardar.isPending} className="btn-primary">
              {guardar.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Guardar permisos
            </button>
            <span className="text-xs text-gray-400">
              {ALL_KEYS.filter((k) => checks[k]).length} de {ALL_KEYS.length} secciones permitidas
            </span>
          </div>
        </>
      )}
    </div>
  );
}
