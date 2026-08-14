import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Warehouse, Plus, Pencil, Monitor, Receipt, Zap, X, Search, Clock, Globe, MapPin, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';

// Un favorito puede apuntar al producto o a una presentación suya específica
// (ej. "Paleta suelta") — la clave para comparar/excluir no puede ser solo el
// id del producto (ver también VentaMostrador.jsx).
const claveFavorito = (p) => (p.presentacion_id ? `pres-${p.presentacion_id}` : `prod-${p.producto_id}`);

// Elige texto claro u oscuro según la luminosidad del color de fondo elegido.
function textColorFor(hex) {
  const c = (hex || '').replace('#', '');
  if (c.length !== 6) return '#1f2937';
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#1f2937' : '#ffffff';
}

/**
 * Sucursales y cajas del POS (permiso pos-admin).
 * Una sucursal se liga 1:1 a un almacén existente: las ventas de mostrador
 * descuentan inventario de ese almacén (FEFO).
 */
export default function Sucursales() {
  const qc = useQueryClient();
  const [modalSucursal, setModalSucursal] = useState(null); // null | {} | sucursal
  const [modalCaja, setModalCaja] = useState(null);         // null | { sucursal }

  const { data: sucursales = [], isLoading } = useQuery({
    queryKey: ['pos-sucursales'],
    queryFn: () => api.get('/pos/sucursales').then((r) => r.data),
  });
  const { data: cajas = [] } = useQuery({
    queryKey: ['pos-cajas'],
    queryFn: () => api.get('/pos/cajas').then((r) => r.data),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Warehouse size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Sucursales y cajas</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/pos/facturas-globales" className="btn-secondary">
            <Receipt size={15} /> Facturas globales
          </Link>
          <button className="btn-primary" onClick={() => setModalSucursal({})}>
            <Plus size={16} /> Nueva sucursal
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-gray-400">Cargando…</p>
      ) : !sucursales.length ? (
        <div className="card text-center text-gray-500 py-10">
          Aún no hay sucursales. Crea la primera eligiendo el almacén que surtirá el mostrador.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sucursales.map((s) => (
            <div key={s.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">
                    {s.nombre}{' '}
                    <span className="text-xs text-gray-400 font-mono">{s.codigo}</span>
                    {!s.activo && <span className="badge-gray ml-2">Inactiva</span>}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Almacén: {s.almacen_nombre} ({s.almacen_codigo})
                  </p>
                  {s.direccion && <p className="text-xs text-gray-400 mt-0.5">{s.direccion}</p>}
                </div>
                <button
                  className="p-1.5 text-gray-400 hover:text-brand-500 rounded-lg"
                  onClick={() => setModalSucursal(s)}
                  title="Editar"
                >
                  <Pencil size={15} />
                </button>
              </div>

              <div className="mt-4 border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cajas</p>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setModalCaja({ sucursal: s })}
                  >
                    <Plus size={13} /> Agregar caja
                  </button>
                </div>
                {cajas.filter((c) => c.sucursal_id === s.id).map((c) => (
                  <div key={c.id} className="flex items-center gap-2 py-1 text-sm text-gray-700">
                    <Monitor size={14} className="text-gray-400" />
                    <span className="flex-1">{c.nombre}</span>
                    {c.turno_abierto_id
                      ? <span className="badge-green">Turno abierto</span>
                      : <span className="badge-gray">Sin turno</span>}
                    {!c.activo && <span className="badge-red">Inactiva</span>}
                  </div>
                ))}
                {!cajas.some((c) => c.sucursal_id === s.id) && (
                  <p className="text-xs text-gray-400">Sin cajas registradas.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalSucursal !== null && (
        <ModalSucursal
          sucursal={modalSucursal.id ? modalSucursal : null}
          onClose={() => setModalSucursal(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['pos-sucursales'] }); setModalSucursal(null); }}
        />
      )}
      {modalCaja !== null && (
        <ModalCaja
          sucursal={modalCaja.sucursal}
          onClose={() => setModalCaja(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['pos-cajas'] }); setModalCaja(null); }}
        />
      )}
    </div>
  );
}

function ModalSucursal({ sucursal, onClose, onSaved }) {
  const [form, setForm] = useState({
    almacen_id: sucursal?.almacen_id || '',
    codigo: sucursal?.codigo || '',
    nombre: sucursal?.nombre || '',
    direccion: sucursal?.direccion || '',
    telefono: sucursal?.telefono || '',
    activo: sucursal ? !!sucursal.activo : true,
    latitud: sucursal?.latitud ?? '',
    longitud: sucursal?.longitud ?? '',
    publicar_web: sucursal ? !!sucursal.publicar_web : false,
    responsable_sanitario: sucursal?.responsable_sanitario || '',
    cedula_responsable_sanitario: sucursal?.cedula_responsable_sanitario || '',
    licencia_sanitaria: sucursal?.licencia_sanitaria || '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const [favoritos, setFavoritos] = useState([]); // [{id, sku_interno, descripcion}]

  const { data: almacenes = [] } = useQuery({
    queryKey: ['almacenes'],
    queryFn: () => api.get('/almacenes').then((r) => r.data),
  });

  const { data: favoritosActuales, isLoading: cargandoFavoritos } = useQuery({
    queryKey: ['pos-favoritos', sucursal?.id],
    queryFn: () => api.get('/pos/productos/favoritos', { params: { sucursal_id: sucursal.id } }).then((r) => r.data),
    enabled: !!sucursal,
  });
  useEffect(() => { if (favoritosActuales) setFavoritos(favoritosActuales); }, [favoritosActuales]);

  const guardar = useMutation({
    mutationFn: () => (sucursal
      ? api.put(`/pos/sucursales/${sucursal.id}`, {
          ...form, activo: form.activo ? 1 : 0, publicar_web: form.publicar_web ? 1 : 0,
          productos_favoritos: favoritos.map((p) => ({
            id: p.producto_id, color: p.color || null, presentacion_id: p.presentacion_id || undefined,
          })),
        })
      : api.post('/pos/sucursales', { ...form, publicar_web: form.publicar_web ? 1 : 0 })),
    onSuccess: () => { toast.success('Sucursal guardada'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  return (
    <Modal title={sucursal ? 'Editar sucursal' : 'Nueva sucursal'} onClose={onClose} size="md">
      <div className="space-y-3">
        {!sucursal && (
          <div>
            <label className="label">Almacén (surtirá el mostrador)</label>
            <select
              className="input"
              value={form.almacen_id}
              onChange={(e) => set('almacen_id', e.target.value)}
            >
              <option value="">— Elegir almacén —</option>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre} ({a.codigo})</option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Código</label>
            <input className="input" value={form.codigo} onChange={(e) => set('codigo', e.target.value)} placeholder="SUC-01" />
          </div>
          <div>
            <label className="label">Nombre</label>
            <input className="input" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Farmacia Centro" />
          </div>
        </div>
        <div>
          <label className="label">Dirección</label>
          <input className="input" value={form.direccion} onChange={(e) => set('direccion', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Teléfono</label>
            <input className="input" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} />
          </div>
          {sucursal && (
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.activo}
                  onChange={(e) => set('activo', e.target.checked)}
                />
                Activa
              </label>
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 pt-3">
          <label className="label flex items-center gap-1.5">
            <Globe size={13} className="text-brand-500" /> Tienda en línea
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
            <input type="checkbox" checked={form.publicar_web}
              onChange={(e) => set('publicar_web', e.target.checked)} />
            Mostrar esta sucursal en el catálogo público
          </label>
          <p className="text-xs text-gray-400 mb-2">
            Publica dirección, teléfono, horario y mapa en el pie de /tienda.
            Las sucursales que en realidad son almacenes internos deben quedar sin marcar.
          </p>
          {form.publicar_web && (
            <UbicacionSucursal
              latitud={form.latitud} longitud={form.longitud}
              onChange={(lat, lng) => { set('latitud', lat); set('longitud', lng); }}
            />
          )}
        </div>

        {form.publicar_web && (
          <div className="border-t border-gray-100 pt-3">
            <label className="label flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-brand-500" /> Datos sanitarios (COFEPRIS)
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Se muestran en la tarjeta de esta sucursal en /tienda. Déjalos en blanco si aún no los tienes a la mano.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Responsable sanitario</label>
                <input className="input" value={form.responsable_sanitario}
                  onChange={(e) => set('responsable_sanitario', e.target.value)}
                  placeholder="Nombre del QFB responsable" />
              </div>
              <div>
                <label className="label">Cédula profesional</label>
                <input className="input" value={form.cedula_responsable_sanitario}
                  onChange={(e) => set('cedula_responsable_sanitario', e.target.value)} />
              </div>
              <div>
                <label className="label">Aviso de Funcionamiento</label>
                <input className="input" value={form.licencia_sanitaria}
                  onChange={(e) => set('licencia_sanitaria', e.target.value)}
                  placeholder="No. de licencia COFEPRIS" />
              </div>
            </div>
          </div>
        )}

        {sucursal && (
          <div className="border-t border-gray-100 pt-3">
            <label className="label flex items-center gap-1.5">
              <Zap size={13} className="text-brand-500" /> Accesos rápidos de venta (máx. 5)
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Botones de compra directa en la pantalla de venta mostrador, para los productos más vendidos de esta sucursal.
            </p>
            {!!favoritos.length && (
              <div className="flex flex-wrap gap-2 mb-2">
                {favoritos.map((p) => (
                  <span
                    key={claveFavorito(p)}
                    className="flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-full border text-xs"
                    style={{
                      backgroundColor: p.color || '#eff6ff',
                      borderColor: p.color || '#dbeafe',
                      color: p.color ? textColorFor(p.color) : '#1d4ed8',
                    }}
                  >
                    <input
                      type="color"
                      value={p.color || '#dbeafe'}
                      onChange={(e) => setFavoritos((f) => f.map((x) => (claveFavorito(x) === claveFavorito(p) ? { ...x, color: e.target.value } : x)))}
                      className="w-5 h-5 rounded-full border-0 cursor-pointer bg-transparent p-0"
                      title="Color de fondo del botón"
                    />
                    <span className="truncate max-w-[8rem]">{p.descripcion}</span>
                    <button type="button" className="hover:text-red-500" onClick={() => setFavoritos((f) => f.filter((x) => claveFavorito(x) !== claveFavorito(p)))}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {favoritos.length < 5 && (
              <BuscadorFavoritos
                sucursalId={sucursal.id}
                excluir={favoritos.map(claveFavorito)}
                onElegir={(p) => setFavoritos((f) => [...f, p])}
              />
            )}
          </div>
        )}

        {sucursal && (
          <div className="border-t border-gray-100 pt-3">
            <HorarioSucursal sucursalId={sucursal.id} />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn-primary"
            disabled={guardar.isPending || cargandoFavoritos || !form.codigo.trim() || !form.nombre.trim() || (!sucursal && !form.almacen_id)}
            onClick={() => guardar.mutate()}
          >
            {cargandoFavoritos ? 'Cargando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BuscadorFavoritos({ sucursalId, excluir, onElegir }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState([]);

  useEffect(() => {
    if (!q.trim()) { setResultados([]); return; }
    const t = setTimeout(() => {
      api.get('/pos/productos/buscar', { params: { q: q.trim(), sucursal_id: sucursalId } })
        .then((r) => setResultados(r.data.filter((p) => !excluir.includes(claveFavorito(p)))))
        .catch(() => setResultados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, sucursalId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-8 text-sm"
          placeholder="Buscar producto por SKU o descripción…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {!!resultados.length && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {resultados.map((p) => (
            <button
              key={claveFavorito(p)}
              type="button"
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-50 text-sm"
              onClick={() => { onElegir(p); setQ(''); setResultados([]); }}
            >
              <span className="truncate">{p.descripcion}</span>
              <span className="text-xs text-gray-400 font-mono shrink-0">{p.sku_interno}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Obtener coordenadas sin salir de Google Maps: clic derecho sobre el local →
// el primer renglón del menú son las coordenadas y al hacer clic se copian
// como "19.432608, -99.133209". Se aceptan también URLs largas pegadas de la
// barra de direcciones. Los enlaces cortos (maps.app.goo.gl) NO traen
// coordenadas — habría que seguir el redirect desde el servidor, así que se
// rechazan con un mensaje que explica qué hacer.
function parsearUbicacion(texto) {
  const t = (texto || '').trim();
  if (!t) return null;
  // !3d/!4d = el pin real del lugar; @lat,lng = sólo el centro de la vista.
  // Por eso se intenta primero !3d/!4d.
  const m = t.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/)
         || t.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)
         || t.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// Vista previa + caja de pegado de la ubicación de la sucursal (alimenta el
// mapa embebido del pie de /tienda, ver tienda.controller.js#mapaEmbed).
function UbicacionSucursal({ latitud, longitud, onChange }) {
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const tieneCoords = latitud !== '' && longitud !== '' && latitud != null && longitud != null;

  const usar = () => {
    if (/maps\.app\.goo\.gl/i.test(texto)) {
      setError('Los enlaces cortos de maps.app.goo.gl no incluyen las coordenadas. Ábrelo en el navegador y copia la URL larga, o haz clic derecho sobre el local en Google Maps y elige las coordenadas.');
      return;
    }
    const r = parsearUbicacion(texto);
    if (!r) { setError('No se reconocieron coordenadas válidas en ese texto.'); return; }
    setError('');
    setTexto('');
    onChange(r.lat, r.lng);
  };

  return (
    <div className="space-y-2">
      {!tieneCoords ? (
        <div className="flex gap-2">
          <input
            className="input text-sm flex-1"
            placeholder="Pega aquí: 19.432608, -99.133209 (clic derecho en Google Maps → coordenadas)"
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setError(''); }}
          />
          <button type="button" className="btn-secondary btn-sm shrink-0" onClick={usar} disabled={!texto.trim()}>
            Usar ubicación
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <MapPin size={13} className="text-brand-500 shrink-0" />
          <span className="font-mono">{Number(latitud).toFixed(6)}, {Number(longitud).toFixed(6)}</span>
          <button type="button" className="text-red-500 hover:underline" onClick={() => onChange('', '')}>
            Quitar
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {tieneCoords && (
        <iframe
          className="w-full aspect-video rounded-lg border border-gray-200"
          src={`https://maps.google.com/maps?q=${latitud},${longitud}&z=16&output=embed`}
          loading="lazy"
          title="Vista previa de la ubicación"
        />
      )}
    </div>
  );
}

const DIAS_SEMANA = [
  { v: 1, label: 'Lunes' }, { v: 2, label: 'Martes' }, { v: 3, label: 'Miércoles' },
  { v: 4, label: 'Jueves' }, { v: 5, label: 'Viernes' }, { v: 6, label: 'Sábado' }, { v: 7, label: 'Domingo' },
];

// Horario semanal que consulta el chatbot de WhatsApp para contestar
// "¿están abiertos?" (whatsapp.chatbot.service.js). Reemplazo total de la
// semana en cada guardado — más simple que diffear día por día.
function HorarioSucursal({ sucursalId }) {
  const [dias, setDias] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pos-horarios-sucursal', sucursalId],
    queryFn: () => api.get(`/pos/sucursales/${sucursalId}/horarios`).then((r) => r.data),
  });

  useEffect(() => {
    if (!data) return;
    setDias(DIAS_SEMANA.map((d) => {
      const existente = data.find((h) => h.dia_semana === d.v);
      return {
        dia_semana: d.v,
        hora_inicio: existente?.hora_inicio ? existente.hora_inicio.slice(0, 5) : '10:00',
        hora_fin: existente?.hora_fin ? existente.hora_fin.slice(0, 5) : '20:00',
        cerrado: existente ? !!existente.cerrado : false,
      };
    }));
  }, [data]);

  const set = (v, campo, valor) => setDias((ds) => ds.map((d) => (d.dia_semana === v ? { ...d, [campo]: valor } : d)));

  const guardar = useMutation({
    mutationFn: () => api.put(`/pos/sucursales/${sucursalId}/horarios`, { dias }),
    onSuccess: () => toast.success('Horario guardado'),
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar horario'),
  });

  return (
    <div>
      <label className="label flex items-center gap-1.5">
        <Clock size={13} className="text-brand-500" /> Horario de atención
      </label>
      <p className="text-xs text-gray-400 mb-2">
        Lo usa el chatbot de WhatsApp para contestar "¿están abiertos?" y, si la sucursal está
        publicada, también se muestra en el pie del catálogo público /tienda.
      </p>
      {!dias || isLoading ? (
        <p className="text-xs text-gray-400">Cargando…</p>
      ) : (
        <div className="space-y-1.5">
          {dias.map((d) => (
            <div key={d.dia_semana} className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0 text-gray-600">{DIAS_SEMANA.find((x) => x.v === d.dia_semana).label}</span>
              <label className="flex items-center gap-1 text-xs text-gray-500 w-20 shrink-0">
                <input type="checkbox" checked={d.cerrado} onChange={(e) => set(d.dia_semana, 'cerrado', e.target.checked)} />
                Cerrado
              </label>
              {!d.cerrado && (
                <>
                  <input type="time" className="input py-1 text-xs w-24" value={d.hora_inicio}
                    onChange={(e) => set(d.dia_semana, 'hora_inicio', e.target.value)} />
                  <span className="text-gray-400">a</span>
                  <input type="time" className="input py-1 text-xs w-24" value={d.hora_fin}
                    onChange={(e) => set(d.dia_semana, 'hora_fin', e.target.value)} />
                </>
              )}
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <button type="button" className="btn-secondary btn-sm" disabled={guardar.isPending} onClick={() => guardar.mutate()}>
              {guardar.isPending ? 'Guardando…' : 'Guardar horario'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModalCaja({ sucursal, onClose, onSaved }) {
  const [nombre, setNombre] = useState('');
  const guardar = useMutation({
    mutationFn: () => api.post('/pos/cajas', { sucursal_id: sucursal.id, nombre }),
    onSuccess: () => { toast.success('Caja creada'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al crear la caja'),
  });

  return (
    <Modal title={`Nueva caja — ${sucursal.nombre}`} onClose={onClose} size="sm">
      <div className="space-y-3">
        <div>
          <label className="label">Nombre de la caja</label>
          <input
            className="input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Caja 1"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn-primary"
            disabled={guardar.isPending || !nombre.trim()}
            onClick={() => guardar.mutate()}
          >
            Crear
          </button>
        </div>
      </div>
    </Modal>
  );
}
