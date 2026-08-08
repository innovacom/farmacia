import { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Store, Trash2, Minus, Plus, ScanBarcode, Zap, CalendarClock, X, BellRing, CheckCircle2, PencilLine, Search, Heart, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useBranding } from '../../hooks/useBranding';
import { usePermisos } from '../../hooks/usePermisos';
import { AperturaTurno } from './Turnos';
import ModalCobro from './components/ModalCobro';
import ModalReceta from './components/ModalReceta';
import ModalPrecio from './components/ModalPrecio';
import ModalExistencia from './components/ModalExistencia';
import TicketPrint, { usePrintTicket } from './components/TicketPrint';
import Modal from '../../components/ui/Modal';
import { linkWhatsApp, mensajeRecordatorioCita } from '../../utils/whatsapp';

const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

// Elige texto claro u oscuro según la luminosidad del color de fondo elegido.
function textColorFor(hex) {
  const c = (hex || '').replace('#', '');
  if (c.length !== 6) return '#1f2937';
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#1f2937' : '#ffffff';
}

const CLASIF_LIBRES = ['libre', 'venta_farmacia'];
const CLASIF_LABEL = {
  antibiotico: 'Antibiótico', fraccion_i: 'Fracción I',
  fraccion_ii: 'Fracción II', fraccion_iii: 'Fracción III',
};

// Clave del carrito: un mismo producto puede estar dos veces en el carrito
// como presentaciones distintas (ej. "1 pieza suelta" + "1 vitrolero"), así
// que la clave no puede ser solo producto_id — incluye la presentación.
const claveCarrito = (p) => (p.presentacion_id ? `pres-${p.presentacion_id}` : `prod-${p.producto_id}`);

function carritoReducer(state, action) {
  switch (action.type) {
    case 'agregar': {
      const key = claveCarrito(action.producto);
      const existe = state.find((i) => i.key === key);
      if (existe) {
        return state.map((i) => (i.key === key ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      // precioPromo/descuentoPct/promocionNombre vienen decorados por el
      // backend (pos.ventas.service.js#decorarPromos) sobre el precio_lista
      // de ESTA fila (ya resuelto por presentación si aplica). `precio`
      // arranca en el precio con promoción si hay una vigente, así el total
      // en pantalla ya coincide con lo que crearVenta va a cobrar.
      const precioPromo = action.producto.precio_final != null
        && Math.abs(Number(action.producto.precio_final) - Number(action.producto.precio_lista)) > 0.005
        ? Number(action.producto.precio_final) : null;
      return [...state, {
        key,
        producto_id: action.producto.producto_id,
        presentacion_id: action.producto.presentacion_id || null,
        descripcion: action.producto.descripcion,
        sku: action.producto.sku_interno,
        precio: precioPromo ?? Number(action.producto.precio_lista),
        precioLista: Number(action.producto.precio_lista),
        precioPromo,
        descuentoPct: action.producto.descuento_pct ?? null,
        promocionNombre: action.producto.promocion_nombre ?? null,
        motivoPrecio: null,
        clasificacion: action.producto.clasificacion_cofepris,
        existencia: Number(action.producto.existencia),
        factorConversion: Number(action.producto.factor_conversion || 1),
        cantidad: 1,
      }];
    }
    case 'cantidad':
      return state
        .map((i) => (i.key === action.key ? { ...i, cantidad: Math.max(0, i.cantidad + action.delta) } : i))
        .filter((i) => i.cantidad > 0);
    case 'quitar':
      return state.filter((i) => i.key !== action.key);
    case 'editarPrecio':
      // `precioLista` NUNCA cambia aquí — siempre queda el precio de catálogo
      // original, aunque la línea ya se haya editado antes, para que el
      // backend/reporte comparen contra catálogo y no contra un valor
      // intermedio (ver pos.ventas.service.js#crearVenta).
      return state.map((i) => (i.key === action.key
        ? { ...i, precio: action.precio, motivoPrecio: action.motivo }
        : i));
    case 'limpiar':
      return [];
    default:
      return state;
  }
}

/**
 * Venta mostrador (permiso pos-venta). Pensada para lector USB en modo
 * teclado: el input de búsqueda recupera el foco solo, el lector "teclea"
 * el EAN + Enter y la partida entra directa al carrito.
 * Atajos: F2 cobrar · F4 limpiar carrito · Esc cerrar modal.
 */
export default function VentaMostrador() {
  const qc = useQueryClient();
  const { can } = usePermisos();
  const puedeFidelidad = can({ key: 'pos-clientes-fidelidad' });
  const puedePedidosWA = can({ key: 'pos-pedidos-whatsapp' });
  const puedeBandejaWA = can({ key: 'whatsapp-bandeja' });
  const branding = useBranding();
  const imprimir = usePrintTicket(branding);
  const [searchParams, setSearchParams] = useSearchParams();
  const citaId = searchParams.get('cita_id');

  const [cajaId, setCajaId] = useState(() => localStorage.getItem('pos-caja') || '');
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState([]);
  const [carrito, dispatch] = useReducer(carritoReducer, []);
  const [modal, setModal] = useState(null); // null | 'cobro' | 'receta'
  const [recetaPendiente, setRecetaPendiente] = useState(null); // datos capturados de receta
  const [ultimaVenta, setUltimaVenta] = useState(null);
  const [editandoPrecioKey, setEditandoPrecioKey] = useState(null); // key del carrito, o null
  const [altaExistencia, setAltaExistencia] = useState(null); // fila de `resultados` sin existencia, o null
  const [clienteFidelidad, setClienteFidelidad] = useState(null); // {id, nombre, telefono, tarjeta_adulto_mayor, programa_lealtad} o null
  const inputRef = useRef(null);

  useEffect(() => { if (cajaId) localStorage.setItem('pos-caja', cajaId); }, [cajaId]);

  const { data: cajas = [] } = useQuery({
    queryKey: ['pos-cajas'],
    queryFn: () => api.get('/pos/cajas').then((r) => r.data),
  });

  const { data: turno, isFetching: cargandoTurno } = useQuery({
    queryKey: ['pos-turno-actual', cajaId],
    queryFn: () =>
      api.get('/pos/turnos/actual', { params: { caja_id: cajaId } })
        .then((r) => r.data)
        .catch((e) => { if (e.response?.status === 404) return null; throw e; }),
    enabled: !!cajaId,
  });

  const caja = cajas.find((c) => String(c.id) === String(cajaId));
  const sucursalId = caja?.sucursal_id;

  // clienteFidelidad en la queryKey: si se elige/quita cliente, los precios
  // de favoritos se recalculan (promociones con requiere_cliente).
  const { data: favoritos = [] } = useQuery({
    queryKey: ['pos-favoritos', sucursalId, clienteFidelidad?.id],
    queryFn: () => api.get('/pos/productos/favoritos', {
      params: { sucursal_id: sucursalId, cliente_fidelidad_id: clienteFidelidad?.id },
    }).then((r) => r.data),
    enabled: !!sucursalId,
  });

  // Cobro de una cita agendada (ver Pos/Citas.jsx "Cobrar"): la venta se
  // hace normal, solo se muestra el paciente y al terminar se liga la cita.
  const { data: citaInfo } = useQuery({
    queryKey: ['pos-cita', citaId],
    queryFn: () => api.get(`/pos/citas/${citaId}`).then((r) => r.data),
    enabled: !!citaId,
  });

  const total = carrito.reduce((a, i) => a + i.cantidad * i.precio, 0);
  const hayControlados = carrito.some((i) => !CLASIF_LIBRES.includes(i.clasificacion));

  // Foco permanente para el lector (salvo modal abierto)
  const refocus = useCallback(() => {
    if (!modal && !editandoPrecioKey && !altaExistencia) inputRef.current?.focus();
  }, [modal, editandoPrecioKey, altaExistencia]);
  useEffect(() => { refocus(); }, [modal, editandoPrecioKey, altaExistencia, refocus]);

  // Atajos de teclado
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F2') { e.preventDefault(); if (carrito.length && !modal && !editandoPrecioKey && !altaExistencia) abrirCobro(); }
      if (e.key === 'F4') { e.preventDefault(); if (!modal && !editandoPrecioKey && !altaExistencia) { dispatch({ type: 'limpiar' }); setRecetaPendiente(null); } }
      if (e.key === 'Escape') {
        if (modal) setModal(null);
        else if (editandoPrecioKey) setEditandoPrecioKey(null);
        else if (altaExistencia) setAltaExistencia(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function buscar(texto) {
    if (!texto.trim() || !sucursalId) return;
    try {
      const { data } = await api.get('/pos/productos/buscar', {
        params: { q: texto.trim(), sucursal_id: sucursalId, cliente_fidelidad_id: clienteFidelidad?.id },
      });
      // Match exacto único → se agrega directo (lector de código de barras).
      // Si el EAN escaneado tiene varias presentaciones (ej. el vitrolero
      // también se puede vender por pieza), se listan para que el cajero elija.
      if (data.length === 1 && data[0].match === 'exacto') {
        agregarProducto(data[0]);
        setQ(''); setResultados([]);
      } else if (data.length) {
        setResultados(data);
      } else {
        toast.error('Sin resultados');
        setResultados([]);
      }
    } catch (e) {
      toast.error(e.response?.data?.error || 'Error al buscar');
    }
  }

  function agregarProducto(p) {
    if (!(Number(p.precio_lista) > 0)) {
      toast.error(`"${p.descripcion}" no tiene precio de venta configurado`);
      return;
    }
    if (Number(p.existencia) < Number(p.factor_conversion || 1)) {
      toast.error(`"${p.descripcion}" sin existencia suficiente en esta sucursal`);
      return;
    }
    dispatch({ type: 'agregar', producto: p });
    setQ(''); setResultados([]);
    refocus();
  }

  function abrirCobro() {
    // Si hay controlados y aún no se capturó receta, primero la receta.
    if (hayControlados && !recetaPendiente) setModal('receta');
    else setModal('cobro');
  }

  const vender = useMutation({
    mutationFn: async ({ receptor, ...payload }) => {
      const { data } = await api.post('/pos/ventas', payload);
      // Factura individual en caja: la venta ya quedó registrada; si el
      // timbrado falla se avisa pero la venta NO se revierte (se puede
      // facturar después desde el historial).
      if (receptor) {
        try {
          await api.post(`/pos/ventas/${data.id}/facturar`, { receptor });
          toast.success('CFDI timbrado');
        } catch (e) {
          const f = e.response?.data?.faltantes;
          toast.error(`Venta registrada, pero el CFDI falló: ${e.response?.data?.error || e.message}`
            + (f ? ` (${f.join(', ')})` : ''));
        }
      }
      return { data };
    },
    onSuccess: ({ data }) => {
      setModal(null);
      dispatch({ type: 'limpiar' });
      setRecetaPendiente(null);
      setClienteFidelidad(null);
      setUltimaVenta(data);
      qc.invalidateQueries({ queryKey: ['pos-corte'] });
      toast.success(`Venta ${data.folio} registrada`);
      // Imprimir en cuanto el ticket esté montado
      setTimeout(() => imprimir(), 150);
      if (citaId) {
        api.post(`/pos/citas/${citaId}/pagar`, { venta_id: data.id })
          .then(() => {
            toast.success(`Cita de ${citaInfo?.paciente_nombre || 'paciente'} cobrada`);
            qc.invalidateQueries({ queryKey: ['pos-citas'] });
            setSearchParams({}, { replace: true });
          })
          .catch((e) => toast.error(e.response?.data?.error || 'La venta se registró, pero no se pudo ligar a la cita'));
      }
    },
    onError: (e) => {
      const r = e.response;
      if (r?.status === 422) {
        toast.error(`${r.data.error}: ${(r.data.productos || []).join(', ')}`);
        setModal('receta');
      } else if (r?.status === 409 && r.data?.disponible !== undefined) {
        toast.error(`${r.data.error} (disponible: ${r.data.disponible})`);
      } else {
        toast.error(r?.data?.error || 'Error al registrar la venta');
      }
    },
  });

  function confirmarCobro({ efectivo, tarjeta, client_uuid, receptor }) {
    vender.mutate({
      client_uuid,
      turno_id: turno.id,
      partidas: carrito.map((i) => ({
        producto_id: i.producto_id,
        presentacion_id: i.presentacion_id || undefined,
        cantidad: i.cantidad,
        // Solo se manda si la línea se editó (ver ModalPrecio); si coincide
        // con el precio de catálogo, el backend no espera nada distinto.
        precio_unitario: i.motivoPrecio ? i.precio : undefined,
        motivo_precio: i.motivoPrecio || undefined,
      })),
      pagos: { efectivo, tarjeta },
      receta: recetaPendiente || undefined,
      receptor,
      cliente_fidelidad_id: clienteFidelidad?.id || undefined,
    });
  }

  if (!cajaId || (!turno && !cargandoTurno)) {
    return (
      <div>
        <Encabezado />
        <div className="card mb-4 max-w-md">
          <label className="label">Caja</label>
          <select className="input" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
            <option value="">— Elegir caja —</option>
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>{c.sucursal_nombre} · {c.nombre}</option>
            ))}
          </select>
        </div>
        {cajaId && !turno && !cargandoTurno && (
          <AperturaTurno cajaId={cajaId} onAbierto={() =>
            qc.invalidateQueries({ queryKey: ['pos-turno-actual'] })} />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <Encabezado extra={`${caja?.sucursal_nombre || ''} · ${caja?.nombre || ''} · Turno #${turno?.id ?? ''}`} />

      {puedePedidosWA && <AvisoPedidosWhatsApp />}

      {puedeBandejaWA && <AvisoMensajesPendientes />}

      <RecordatorioCitas sucursalId={sucursalId} />

      {citaId && citaInfo && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 flex items-center justify-between no-print">
          <div className="flex items-center gap-2 text-brand-700">
            <CalendarClock size={18} />
            <p className="text-sm">
              Cobrando cita de <span className="font-semibold">{citaInfo.paciente_nombre}</span> — {citaInfo.hora_inicio.slice(0, 5)}
            </p>
          </div>
          <button
            className="text-brand-400 hover:text-brand-700"
            title="Quitar referencia a la cita"
            onClick={() => setSearchParams({}, { replace: true })}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {puedeFidelidad && (
        <SelectorClienteFidelidad
          cliente={clienteFidelidad}
          bloqueado={carrito.length > 0}
          onElegir={setClienteFidelidad}
          onQuitar={() => setClienteFidelidad(null)}
        />
      )}

      {/* Búsqueda / scanner */}
      <div className="relative mb-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <ScanBarcode size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              className="input pl-10 py-3 text-lg"
              placeholder="Escanea el código de barras o escribe para buscar…"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
              onBlur={() => setTimeout(refocus, 100)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(q); } }}
            />
          </div>
        </div>
        {!!resultados.length && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-80 overflow-y-auto">
            {resultados.map((p) => {
              // Disponible en UNIDADES de esta presentación (ej. vitroleros completos),
              // no piezas sueltas — si ya se vendió una pieza, puede no alcanzar
              // para el vitrolero aunque la existencia en piezas no sea 0.
              const disponibles = Math.floor(Number(p.existencia) / Number(p.factor_conversion || 1));
              return (
                <div key={claveCarrito(p)} className="flex items-center gap-2 border-b border-gray-50">
                  <button
                    type="button"
                    className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={disponibles <= 0}
                    onClick={() => agregarProducto(p)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.descripcion}</p>
                      <p className="text-xs text-gray-400 font-mono">{p.sku_interno}{p.ean ? ` · ${p.ean}` : ''}</p>
                    </div>
                    {!CLASIF_LIBRES.includes(p.clasificacion_cofepris) && (
                      <span className="badge-yellow">{CLASIF_LABEL[p.clasificacion_cofepris] || 'Receta'}</span>
                    )}
                    <span className={`text-xs ${disponibles > 0 ? 'text-gray-500' : 'text-red-500'}`}>
                      Disp: {disponibles}
                    </span>
                    <span className="text-sm font-semibold">{money(p.precio_lista)}</span>
                  </button>
                  {disponibles <= 0 && (
                    <button
                      type="button"
                      className="shrink-0 mr-3 text-xs text-brand-600 hover:text-brand-700 font-medium whitespace-nowrap"
                      onClick={() => setAltaExistencia(p)}
                    >
                      Registrar existencia
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Accesos rápidos (configurables en Sucursales y cajas) */}
      {!!favoritos.length && (
        <div className="flex flex-wrap gap-2 mb-4">
          {favoritos.map((p) => {
            const texto = p.color ? textColorFor(p.color) : undefined;
            const disponibles = Math.floor(Number(p.existencia) / Number(p.factor_conversion || 1));
            return (
              <button
                key={claveCarrito(p)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left disabled:opacity-40 disabled:cursor-not-allowed ${
                  p.color ? '' : 'border-gray-200 bg-white hover:border-brand-400 hover:bg-brand-50'
                }`}
                style={p.color ? { backgroundColor: p.color, borderColor: p.color } : undefined}
                disabled={disponibles <= 0}
                onClick={() => agregarProducto(p)}
                title={p.descripcion}
              >
                <Zap size={14} className={p.color ? 'shrink-0' : 'text-brand-500 shrink-0'} style={texto ? { color: texto } : undefined} />
                <span className={`text-sm font-medium max-w-[10rem] truncate ${p.color ? '' : 'text-gray-800'}`} style={texto ? { color: texto } : undefined}>
                  {p.descripcion}
                </span>
                <span className="text-xs" style={{ color: texto || '#9ca3af' }}>{money(p.precio_lista)}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Carrito */}
      <div className="card p-0 overflow-hidden mb-4">
        {!carrito.length ? (
          <p className="text-center text-gray-400 py-10">
            Carrito vacío. Escanea un producto para empezar.
          </p>
        ) : (
          <table className="table-auto w-full">
            <thead>
              <tr>
                <th>Producto</th><th className="text-center">Cantidad</th>
                <th className="text-right">Precio</th><th className="text-right">Importe</th><th />
              </tr>
            </thead>
            <tbody>
              {carrito.map((i) => (
                <tr key={i.key}>
                  <td>
                    <p className="font-medium text-gray-900">{i.descripcion}</p>
                    <p className="text-xs text-gray-400 font-mono">{i.sku}</p>
                    {!CLASIF_LIBRES.includes(i.clasificacion) && (
                      <span className="badge-yellow mt-0.5">
                        Requiere receta — {CLASIF_LABEL[i.clasificacion] || i.clasificacion}
                      </span>
                    )}
                  </td>
                  <td className="text-center whitespace-nowrap">
                    <button className="p-1.5 text-gray-400 hover:text-brand-500"
                      onClick={() => dispatch({ type: 'cantidad', key: i.key, delta: -1 })}>
                      <Minus size={16} />
                    </button>
                    <span className="inline-block w-10 text-lg font-semibold">{i.cantidad}</span>
                    <button className="p-1.5 text-gray-400 hover:text-brand-500"
                      onClick={() => dispatch({ type: 'cantidad', key: i.key, delta: 1 })}>
                      <Plus size={16} />
                    </button>
                  </td>
                  <td className="text-right">
                    {i.precio !== i.precioLista && (
                      <p className="text-xs text-gray-400 line-through">{money(i.precioLista)}</p>
                    )}
                    <span className={i.precio !== i.precioLista ? 'text-brand-600 font-medium' : ''} title={i.motivoPrecio || undefined}>
                      {money(i.precio)}
                    </span>
                    {i.promocionNombre && !i.motivoPrecio && (
                      <p className="text-xs text-green-600">−{i.descuentoPct}% {i.promocionNombre}</p>
                    )}
                  </td>
                  <td className="text-right font-semibold">{money(i.cantidad * i.precio)}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="p-1.5 text-gray-300 hover:text-brand-500" title="Editar precio"
                      onClick={() => setEditandoPrecioKey(i.key)}>
                      <PencilLine size={15} />
                    </button>
                    <button className="p-1.5 text-gray-300 hover:text-red-500"
                      onClick={() => dispatch({ type: 'quitar', key: i.key })}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Total + acciones */}
      <div className="flex items-center gap-3">
        <button
          className="btn-pos-secondary"
          disabled={!carrito.length}
          onClick={() => { dispatch({ type: 'limpiar' }); setRecetaPendiente(null); refocus(); }}
        >
          Limpiar (F4)
        </button>
        <div className="flex-1 text-right">
          <p className="text-sm text-gray-500">Total (IVA incluido)</p>
          <p className="text-4xl font-bold text-gray-900">{money(total)}</p>
        </div>
        <button
          className="btn-pos-primary"
          disabled={!carrito.length || vender.isPending}
          onClick={abrirCobro}
        >
          Cobrar (F2)
        </button>
      </div>

      {recetaPendiente && (
        <p className="text-xs text-green-700 mt-2 text-right">
          Receta capturada: {recetaPendiente.paciente_nombre} — se aplicará al cobrar.
        </p>
      )}

      {modal === 'receta' && (
        <ModalReceta
          controlados={carrito.filter((i) => !CLASIF_LIBRES.includes(i.clasificacion))}
          onClose={() => setModal(null)}
          onCapturada={(datos) => { setRecetaPendiente(datos); setModal('cobro'); }}
        />
      )}
      {modal === 'cobro' && (
        <ModalCobro
          total={total}
          isPending={vender.isPending}
          onClose={() => setModal(null)}
          onConfirmar={confirmarCobro}
        />
      )}
      {editandoPrecioKey && carrito.some((i) => i.key === editandoPrecioKey) && (
        <ModalPrecio
          item={carrito.find((i) => i.key === editandoPrecioKey)}
          onClose={() => setEditandoPrecioKey(null)}
          onAplicar={({ precio, motivo }) => {
            dispatch({ type: 'editarPrecio', key: editandoPrecioKey, precio, motivo });
            setEditandoPrecioKey(null);
          }}
        />
      )}

      {altaExistencia && (
        <ModalExistencia
          producto={altaExistencia}
          sucursalId={sucursalId}
          onClose={() => setAltaExistencia(null)}
          onRegistrada={(prod) => {
            setAltaExistencia(null);
            agregarProducto(prod);
          }}
        />
      )}

      <TicketPrint venta={ultimaVenta} branding={branding} />
      {ultimaVenta && (
        <div className="mt-3 text-right no-print">
          <button className="btn-secondary btn-sm" onClick={imprimir}>
            Reimprimir último ticket ({ultimaVenta.folio})
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Cliente de fidelidad ligado a la venta (migrate_v47, opcional): habilita
 * descuentos permanentes por promociones con "requiere_cliente" y liga la
 * venta para reportes. Se bloquea cambiarlo una vez que el carrito tiene
 * productos — si no, los precios ya buscados quedarían desincronizados del
 * total que calcula el servidor al cobrar (mismo problema ya resuelto para
 * promociones automáticas: el precio se decide ANTES de agregar al carrito).
 */
function SelectorClienteFidelidad({ cliente, bloqueado, onElegir, onQuitar }) {
  const [buscando, setBuscando] = useState(false);
  const [altaRapida, setAltaRapida] = useState(false);

  // El carrito puede pasar de vacío a con productos mientras el buscador o
  // el alta rápida ya estaban abiertos (se abrieron sin bloqueo) — hay que
  // cerrarlos en cuanto se bloquea, si no `onElegir`/`onCreado` seguirían
  // alcanzables y aplicarían el cliente a un carrito ya cotizado sin él.
  useEffect(() => {
    if (bloqueado) { setBuscando(false); setAltaRapida(false); }
  }, [bloqueado]);

  function elegir(c) {
    if (bloqueado) return; // defensa extra: no debería poder llamarse ya cerrado
    onElegir(c);
    setBuscando(false);
    setAltaRapida(false);
  }

  if (cliente) {
    return (
      <div className="flex items-center gap-2 mb-4 no-print">
        <span className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border border-pink-200 bg-pink-50 text-pink-700 text-sm">
          <Heart size={13} />
          {cliente.nombre}
          {cliente.tarjeta_adulto_mayor && <span className="badge-green">Adulto mayor</span>}
          {cliente.programa_lealtad && <span className="badge-green">Lealtad</span>}
          {!bloqueado && (
            <button type="button" className="hover:text-red-500 ml-1" onClick={onQuitar} title="Quitar cliente">
              <X size={12} />
            </button>
          )}
        </span>
        {bloqueado && <span className="text-xs text-gray-400">Limpia el carrito para cambiar de cliente</span>}
      </div>
    );
  }

  return (
    <div className="mb-4 no-print">
      {!buscando ? (
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary btn-sm" disabled={bloqueado} onClick={() => setBuscando(true)}>
            <Heart size={14} /> Cliente de fidelidad
          </button>
          <button type="button" className="btn-secondary btn-sm" disabled={bloqueado} onClick={() => setAltaRapida(true)}>
            <UserPlus size={14} /> Nuevo
          </button>
          {bloqueado && <span className="text-xs text-gray-400">Limpia el carrito para elegir un cliente</span>}
        </div>
      ) : (
        <BuscadorClienteFidelidad
          onElegir={elegir}
          onCerrar={() => setBuscando(false)}
        />
      )}
      {altaRapida && (
        <ModalNuevoClienteFidelidad
          onClose={() => setAltaRapida(false)}
          onCreado={elegir}
        />
      )}
    </div>
  );
}

function BuscadorClienteFidelidad({ onElegir, onCerrar }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState([]);

  useEffect(() => {
    if (!q.trim()) { setResultados([]); return; }
    const t = setTimeout(() => {
      api.get('/pos/clientes-fidelidad/buscar', { params: { q: q.trim() } })
        .then((r) => setResultados(r.data))
        .catch(() => setResultados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative max-w-sm">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input pl-8 text-sm" autoFocus placeholder="Buscar por nombre o teléfono…"
          value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(onCerrar, 150)} />
      </div>
      {!!resultados.length && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {resultados.map((c) => (
            <button key={c.id} type="button"
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-50 text-sm"
              onMouseDown={(e) => { e.preventDefault(); onElegir(c); }}>
              <span className="truncate">{c.nombre}</span>
              <span className="text-xs text-gray-400 font-mono shrink-0">{c.telefono}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Alta rápida: solo nombre + teléfono (los demás campos opcionales se
// completan después desde la pantalla completa de Clientes de fidelidad).
function ModalNuevoClienteFidelidad({ onClose, onCreado }) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [tarjetaAdultoMayor, setTarjetaAdultoMayor] = useState(false);
  const [programaLealtad, setProgramaLealtad] = useState(false);

  const crear = useMutation({
    mutationFn: () => api.post('/pos/clientes-fidelidad', {
      nombre, telefono, tarjeta_adulto_mayor: tarjetaAdultoMayor, programa_lealtad: programaLealtad,
    }),
    onSuccess: ({ data }) => {
      toast.success('Cliente registrado');
      onCreado({
        id: data.id, nombre: nombre.trim(), telefono,
        tarjeta_adulto_mayor: tarjetaAdultoMayor, programa_lealtad: programaLealtad,
      });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al registrar'),
  });

  const valido = nombre.trim() && telefono.trim();

  return (
    <Modal title="Nuevo cliente de fidelidad" onClose={onClose} size="sm">
      <div className="space-y-3">
        <div>
          <label className="label">Nombre</label>
          <input className="input" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div>
          <label className="label">Teléfono</label>
          <input className="input" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="10 dígitos" />
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={tarjetaAdultoMayor} onChange={(e) => setTarjetaAdultoMayor(e.target.checked)} />
            Tarjeta de descuento para adultos mayores
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={programaLealtad} onChange={(e) => setProgramaLealtad(e.target.checked)} />
            Asociado a programa de lealtad
          </label>
        </div>
        <p className="text-xs text-gray-400">
          Correo, fecha de nacimiento y enfermedad crónica se pueden agregar después desde Clientes de fidelidad.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valido || crear.isPending} onClick={() => crear.mutate()}>
            Registrar y usar
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Encabezado({ extra }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      <Store size={22} className="text-brand-500" />
      <h1 className="text-2xl font-bold text-gray-900">Venta mostrador</h1>
      {extra && <span className="text-sm text-gray-400 ml-2">{extra}</span>}
      <Link to="/pos/ventas" className="ml-auto text-sm text-brand-500 hover:underline no-print">
        Ver ventas del día →
      </Link>
    </div>
  );
}

/**
 * Banner rojo fijo y pulsante + alarma sonora que se repite (Web Audio, sin
 * archivo de audio) mientras haya pendientes, hasta que se silencia o dejan
 * de estarlo. La alarma se reactiva sola si aparece un pendiente NUEVO aunque
 * ya se hubiera silenciado uno anterior (clave por conjunto de ids — mismo
 * criterio que RecordatorioCitas, de abajo). Parametrizado para los dos avisos
 * de WhatsApp del mostrador (pedidos nuevos / mensajes sin responder), que
 * solo difieren en la consulta, el id, el tono de la alarma y los textos.
 */
function AvisoConAlarma({ queryKey, queryFn, idField, frecuenciaHz, mensajeUno, mensajeVarios, linkTo, linkLabel }) {
  const [silenciado, setSilenciado] = useState(false);
  const audioCtxRef = useRef(null);
  const idsVistosRef = useRef('');

  const { data: pendientes = [] } = useQuery({
    queryKey,
    queryFn,
    refetchInterval: 20000,
  });

  useEffect(() => {
    const clave = pendientes.map((p) => p[idField]).sort((a, b) => a - b).join(',');
    if (clave !== idsVistosRef.current) {
      idsVistosRef.current = clave;
      if (pendientes.length) setSilenciado(false); // pendiente nuevo → vuelve a sonar aunque ya se hubiera silenciado
    }
  }, [pendientes]);

  useEffect(() => {
    if (!pendientes.length || silenciado) return;
    function beep() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = audioCtxRef.current || (audioCtxRef.current = new Ctx());
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frecuenciaHz;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch { /* navegador sin soporte de Web Audio, o autoplay bloqueado */ }
    }
    beep();
    const t = setInterval(beep, 6000);
    return () => clearInterval(t);
  }, [pendientes.length, silenciado]);

  if (!pendientes.length) return null;

  return (
    <div className="mb-4 rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 no-print flex items-center justify-between gap-3 animate-pulse">
      <div className="flex items-center gap-2 text-red-800 font-semibold">
        <BellRing size={18} />
        {pendientes.length === 1 ? mensajeUno : mensajeVarios(pendientes.length)}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!silenciado && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => setSilenciado(true)}>
            Silenciar
          </button>
        )}
        <Link to={linkTo} className="btn-primary btn-sm">{linkLabel}</Link>
      </div>
    </div>
  );
}

// Pedidos nuevos por WhatsApp (whatsapp_carritos → pedidos_whatsapp, estatus
// 'pendiente') pensado para que el dependiente NO los pase por alto — un
// pedido deja de estar pendiente cuando pasa a "preparando" desde Pedidos WhatsApp.
function AvisoPedidosWhatsApp() {
  return (
    <AvisoConAlarma
      queryKey={['wa-pedidos-pendientes-aviso']}
      queryFn={() => api.get('/whatsapp/pedidos', { params: { estatus: 'pendiente' } }).then((r) => r.data)}
      idField="id"
      frecuenciaHz={880}
      mensajeUno="1 pedido nuevo de WhatsApp sin atender"
      mensajeVarios={(n) => `${n} pedidos nuevos de WhatsApp sin atender`}
      linkTo="/pos/pedidos-whatsapp"
      linkLabel="Ver pedidos"
    />
  );
}

// Conversaciones de WhatsApp (Bandeja) cuyo último mensaje sigue sin
// respuesta — típicamente porque el chatbot no reconoció la intención (o
// falló) y no contestó nada, pero también cubre cualquier otro caso (el
// cliente volvió a escribir después de que el bot ya había contestado, un
// tipo de mensaje que el bot no maneja, etc.).
function AvisoMensajesPendientes() {
  return (
    <AvisoConAlarma
      queryKey={['wa-mensajes-pendientes-aviso']}
      queryFn={() => api.get('/whatsapp/conversaciones/pendientes-responder').then((r) => r.data)}
      idField="contacto_id"
      frecuenciaHz={660}
      mensajeUno="1 mensaje de WhatsApp sin responder"
      mensajeVarios={(n) => `${n} mensajes de WhatsApp sin responder`}
      linkTo="/whatsapp/bandeja"
      linkLabel="Ver bandeja"
    />
  );
}

/**
 * Recuerda al empleado las citas de hoy/mañana que siguen sin confirmar con
 * el paciente. La primera vez que aparecen en la sesión se muestra como
 * pantalla emergente (para no pasarla por alto); mientras sigan pendientes,
 * queda además el aviso fijo arriba de la pantalla de venta.
 * El botón de WhatsApp abre wa.me con el mensaje ya redactado (envío manual,
 * un clic) — la automatización con la API oficial de Meta queda pendiente.
 */
function RecordatorioCitas({ sucursalId }) {
  const qc = useQueryClient();
  const [modalAbierto, setModalAbierto] = useState(false);
  const yaAvisadoRef = useRef(new Set());

  const { data: pendientes = [] } = useQuery({
    queryKey: ['pos-citas-pendientes-confirmar', sucursalId],
    queryFn: () => api.get('/pos/citas/pendientes-confirmar', { params: { sucursal_id: sucursalId } }).then((r) => r.data),
    enabled: !!sucursalId,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: waEstado } = useQuery({
    queryKey: ['whatsapp-estado'],
    queryFn: () => api.get('/whatsapp/estado').then((r) => r.data),
  });

  const confirmar = useMutation({
    mutationFn: (id) => api.post(`/pos/citas/${id}/confirmar`, {}),
    onSuccess: () => {
      toast.success('Cita confirmada');
      qc.invalidateQueries({ queryKey: ['pos-citas-pendientes-confirmar'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al confirmar'),
  });

  const enviarRecordatorioApi = useMutation({
    mutationFn: (id) => api.post(`/pos/citas/${id}/recordatorio-whatsapp`, {}),
    onSuccess: () => toast.success('Recordatorio enviado por WhatsApp'),
    onError: (e) => toast.error(e.response?.data?.error || 'Error al enviar el recordatorio'),
  });

  useEffect(() => {
    if (!sucursalId || !pendientes.length) return;
    const clave = `${sucursalId}-${pendientes.map((c) => c.id).sort().join(',')}`;
    if (!yaAvisadoRef.current.has(clave)) {
      yaAvisadoRef.current.add(clave);
      setModalAbierto(true);
    }
  }, [sucursalId, pendientes]);

  if (!pendientes.length) return null;

  const Lista = (
    <div className="space-y-2">
      {pendientes.map((c) => (
        <div key={c.id} className="flex items-center gap-3 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">
              {c.paciente_nombre} <span className="text-gray-400 font-normal">— {String(c.fecha).slice(0, 10)} {c.hora_inicio.slice(0, 5)}</span>
            </p>
            {c.servicio_descripcion && <p className="text-xs text-gray-500">{c.servicio_descripcion}</p>}
          </div>
          {c.paciente_telefono && (
            waEstado?.configurado ? (
              <button
                className="btn-secondary btn-sm shrink-0"
                disabled={enviarRecordatorioApi.isPending}
                onClick={() => enviarRecordatorioApi.mutate(c.id)}
              >
                WhatsApp
              </button>
            ) : (
              <a
                className="btn-secondary btn-sm shrink-0"
                href={linkWhatsApp(c.paciente_telefono, mensajeRecordatorioCita(c))}
                target="_blank" rel="noreferrer"
              >
                WhatsApp
              </a>
            )
          )}
          <button
            className="btn-primary btn-sm shrink-0"
            disabled={confirmar.isPending}
            onClick={() => confirmar.mutate(c.id)}
          >
            <CheckCircle2 size={14} /> Confirmar
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 no-print">
        <button
          className="flex items-center gap-2 text-amber-800 font-medium w-full text-left"
          onClick={() => setModalAbierto(true)}
        >
          <BellRing size={18} />
          {pendientes.length === 1
            ? '1 cita sin confirmar — dar clic para ver'
            : `${pendientes.length} citas sin confirmar — dar clic para ver`}
        </button>
      </div>
      {modalAbierto && (
        <Modal title="Citas pendientes de confirmar" onClose={() => setModalAbierto(false)} size="md">
          <p className="text-sm text-gray-500 mb-3">
            Confirma con el paciente que asistirá (llamada o WhatsApp) antes de su cita.
          </p>
          {Lista}
          <div className="flex justify-end pt-3">
            <button className="btn-secondary" onClick={() => setModalAbierto(false)}>Cerrar</button>
          </div>
        </Modal>
      )}
    </>
  );
}
