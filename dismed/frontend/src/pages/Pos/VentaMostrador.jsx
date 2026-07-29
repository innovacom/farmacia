import { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Store, Trash2, Minus, Plus, ScanBarcode, Zap, CalendarClock, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useBranding } from '../../hooks/useBranding';
import { AperturaTurno } from './Turnos';
import ModalCobro from './components/ModalCobro';
import ModalReceta from './components/ModalReceta';
import TicketPrint, { usePrintTicket } from './components/TicketPrint';

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

function carritoReducer(state, action) {
  switch (action.type) {
    case 'agregar': {
      const existe = state.find((i) => i.producto_id === action.producto.id);
      if (existe) {
        return state.map((i) =>
          i.producto_id === action.producto.id ? { ...i, cantidad: i.cantidad + 1 } : i);
      }
      return [...state, {
        producto_id: action.producto.id,
        descripcion: action.producto.descripcion,
        sku: action.producto.sku_interno,
        precio: Number(action.producto.precio_lista),
        clasificacion: action.producto.clasificacion_cofepris,
        existencia: Number(action.producto.existencia),
        cantidad: 1,
      }];
    }
    case 'cantidad':
      return state
        .map((i) => (i.producto_id === action.id ? { ...i, cantidad: Math.max(0, i.cantidad + action.delta) } : i))
        .filter((i) => i.cantidad > 0);
    case 'quitar':
      return state.filter((i) => i.producto_id !== action.id);
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

  const { data: favoritos = [] } = useQuery({
    queryKey: ['pos-favoritos', sucursalId],
    queryFn: () => api.get('/pos/productos/favoritos', { params: { sucursal_id: sucursalId } }).then((r) => r.data),
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
    if (!modal) inputRef.current?.focus();
  }, [modal]);
  useEffect(() => { refocus(); }, [modal, refocus]);

  // Atajos de teclado
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F2') { e.preventDefault(); if (carrito.length && !modal) abrirCobro(); }
      if (e.key === 'F4') { e.preventDefault(); if (!modal) { dispatch({ type: 'limpiar' }); setRecetaPendiente(null); } }
      if (e.key === 'Escape' && modal) setModal(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function buscar(texto) {
    if (!texto.trim() || !sucursalId) return;
    try {
      const { data } = await api.get('/pos/productos/buscar', {
        params: { q: texto.trim(), sucursal_id: sucursalId },
      });
      if (data.length && data[0].match === 'exacto') {
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
    if (!(Number(p.existencia) > 0)) {
      toast.error(`"${p.descripcion}" sin existencia en esta sucursal`);
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
      partidas: carrito.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad })),
      pagos: { efectivo, tarjeta },
      receta: recetaPendiente || undefined,
      receptor,
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
            {resultados.map((p) => (
              <button
                key={p.id}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-50"
                onClick={() => agregarProducto(p)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.descripcion}</p>
                  <p className="text-xs text-gray-400 font-mono">{p.sku_interno}{p.ean ? ` · ${p.ean}` : ''}</p>
                </div>
                {!CLASIF_LIBRES.includes(p.clasificacion_cofepris) && (
                  <span className="badge-yellow">{CLASIF_LABEL[p.clasificacion_cofepris] || 'Receta'}</span>
                )}
                <span className={`text-xs ${Number(p.existencia) > 0 ? 'text-gray-500' : 'text-red-500'}`}>
                  Exist: {Number(p.existencia)}
                </span>
                <span className="text-sm font-semibold">{money(p.precio_lista)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Accesos rápidos (configurables en Sucursales y cajas) */}
      {!!favoritos.length && (
        <div className="flex flex-wrap gap-2 mb-4">
          {favoritos.map((p) => {
            const texto = p.color ? textColorFor(p.color) : undefined;
            return (
              <button
                key={p.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left disabled:opacity-40 disabled:cursor-not-allowed ${
                  p.color ? '' : 'border-gray-200 bg-white hover:border-brand-400 hover:bg-brand-50'
                }`}
                style={p.color ? { backgroundColor: p.color, borderColor: p.color } : undefined}
                disabled={!(Number(p.existencia) > 0)}
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
                <tr key={i.producto_id}>
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
                      onClick={() => dispatch({ type: 'cantidad', id: i.producto_id, delta: -1 })}>
                      <Minus size={16} />
                    </button>
                    <span className="inline-block w-10 text-lg font-semibold">{i.cantidad}</span>
                    <button className="p-1.5 text-gray-400 hover:text-brand-500"
                      onClick={() => dispatch({ type: 'cantidad', id: i.producto_id, delta: 1 })}>
                      <Plus size={16} />
                    </button>
                  </td>
                  <td className="text-right">{money(i.precio)}</td>
                  <td className="text-right font-semibold">{money(i.cantidad * i.precio)}</td>
                  <td className="text-right">
                    <button className="p-1.5 text-gray-300 hover:text-red-500"
                      onClick={() => dispatch({ type: 'quitar', id: i.producto_id })}>
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
