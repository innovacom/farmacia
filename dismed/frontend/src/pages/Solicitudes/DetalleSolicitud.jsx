import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, BarChart2, Send, CheckSquare, Square, Globe, Loader2, Link2, Pencil, X, Check, BookOpen, Zap } from 'lucide-react';
import api from '../../services/api';
import ProductoPicker from '../../components/shared/ProductoPicker';

export default function DetalleSolicitud() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const { data: sol, isLoading } = useQuery({
    queryKey: ['solicitud', id],
    queryFn: () => api.get(`/solicitudes/${id}`).then((r) => r.data),
  });

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get('/proveedores').then((r) => r.data),
  });

  const { data: cotProvs = [] } = useQuery({
    queryKey: ['cotprov', id],
    queryFn: () => api.get(`/cotizaciones-proveedor/solicitud/${id}`).then((r) => r.data),
  });

  const [selProvs, setSelProvs] = useState([]);
  // partidas seleccionadas: null = todas, array de ids = específicas
  const [selPartidas, setSelPartidas] = useState(null);

  const iniciarMut = useMutation({
    mutationFn: ({ provIds, partidaIds }) =>
      api.post('/cotizaciones-proveedor', {
        solicitud_id: parseInt(id),
        proveedor_ids: provIds,
        partida_ids:   partidaIds, // null = todas
      }),
    onSuccess: () => {
      toast.success('Cotizaciones iniciadas. Copia el mensaje y envíalo a cada proveedor.');
      qc.invalidateQueries(['cotprov', id]);
      setSelProvs([]);
      setSelPartidas(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  // ── Bandera IVA por partida (1 = exento / no calcula, 0 = sí calcula. Default 0) ──
  const [ivaOverride, setIvaOverride] = useState({});
  function getIvaExento(p) { return ivaOverride[p.id] ?? p.iva_exento ?? 0; }

  const ivaMut = useMutation({
    mutationFn: ({ pid, iva_exento }) =>
      api.put(`/solicitudes/${id}/partidas/${pid}`, { iva_exento }),
    onError: () => toast.error('No se pudo guardar el ajuste de IVA'),
  });

  function toggleIva(p) {
    const nuevo = getIvaExento(p) ? 0 : 1;
    setIvaOverride((prev) => ({ ...prev, [p.id]: nuevo }));
    ivaMut.mutate({ pid: p.id, iva_exento: nuevo });
  }

  // ── Vinculación de partida con producto del catálogo ──
  const [picker, setPicker] = useState(null); // partida a vincular
  const vincularMut = useMutation({
    mutationFn: (body) => api.put(`/solicitudes/${id}/partidas/${body.pid}`, body.data),
    onSuccess: () => { toast.success('Vínculo actualizado'); qc.invalidateQueries(['solicitud', id]); },
    onError: () => toast.error('No se pudo actualizar el vínculo'),
  });

  // ── Edición inline de partida (cantidad, descripción, U/M, observaciones) ──
  const [editRow, setEditRow] = useState(null); // { id, cantidad, descripcion_original, unidad_medida, observaciones }
  const editarMut = useMutation({
    mutationFn: ({ pid, data }) => api.put(`/solicitudes/${id}/partidas/${pid}`, data),
    onSuccess: () => {
      toast.success('Partida actualizada');
      setEditRow(null);
      qc.invalidateQueries(['solicitud', id]);
      qc.invalidateQueries(['comparador', id]);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo actualizar la partida'),
  });

  function guardarEdicion() {
    const cant = parseFloat(String(editRow.cantidad).trim().replace(',', '.'));
    if (!Number.isFinite(cant) || cant <= 0) return toast.error('Cantidad inválida: debe ser mayor a 0');
    if (!editRow.descripcion_original?.trim()) return toast.error('La descripción no puede quedar vacía');
    editarMut.mutate({
      pid: editRow.id,
      data: {
        cantidad:             cant,
        descripcion_original: editRow.descripcion_original.trim(),
        unidad_medida:        editRow.unidad_medida?.trim() || 'pza',
        observaciones:        editRow.observaciones?.trim() || null,
      },
    });
  }

  function toggleProv(pid) {
    setSelProvs((prev) => prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]);
  }

  function togglePartida(pid) {
    setSelPartidas((prev) => {
      // Si era null (todas), inicializar con todas menos esta
      const current = prev ?? sol.partidas.map((p) => p.id);
      return current.includes(pid)
        ? current.filter((x) => x !== pid)
        : [...current, pid];
    });
  }

  function seleccionarTodasPartidas() { setSelPartidas(null); }

  function iniciar() {
    // si selPartidas == null o tiene todas → enviar null (todas)
    const todasSeleccionadas = selPartidas === null ||
      selPartidas.length === sol?.partidas?.length;
    iniciarMut.mutate({
      provIds:    selProvs,
      partidaIds: todasSeleccionadas ? null : selPartidas,
    });
  }

  const isPartidaSel = (pid) => {
    if (selPartidas === null) return true;
    return selPartidas.includes(pid);
  };

  // ── Búsqueda automática de precios: 1º catálogo de proveedores, 2º internet ──
  const [catSearch, setCatSearch] = useState({ running: false, actual: 0, total: 0, resultados: {} });
  const [webSearch, setWebSearch] = useState({ running: false, actual: 0, total: 0, resultados: {} });
  const cancelarWebRef = useRef(false);
  const autoStartRef = useRef(false);

  // Paso 1: catálogo de proveedores (gratis, inmediato). Devuelve el set de
  // partida_ids que quedaron con precio registrado.
  async function buscarPreciosCatalogo(soloPartidas = null) {
    if (!sol?.partidas?.length || catSearch.running) return new Set();
    const subset = soloPartidas instanceof Set ? soloPartidas : null;
    const partidas = subset ? sol.partidas.filter((p) => subset.has(p.id)) : sol.partidas;
    if (!partidas.length) return new Set();

    setCatSearch({ running: true, actual: 0, total: partidas.length, resultados: {} });
    const resueltas = new Set();
    for (let i = 0; i < partidas.length; i++) {
      const p = partidas[i];
      setCatSearch((prev) => ({ ...prev, actual: i + 1 }));
      try {
        const { data } = await api.post(`/solicitudes/${id}/partidas/${p.id}/buscar-precio-catalogo`, {});
        setCatSearch((prev) => ({ ...prev, resultados: { ...prev.resultados, [p.id]: { ok: true, ...data } } }));
        if (data.registradas > 0) resueltas.add(p.id);
      } catch (err) {
        setCatSearch((prev) => ({
          ...prev,
          resultados: { ...prev.resultados, [p.id]: { ok: false, error: err.response?.data?.error || 'Error' } },
        }));
      }
    }
    setCatSearch((prev) => ({ ...prev, running: false }));
    qc.invalidateQueries(['cotprov', id]);
    qc.invalidateQueries(['solicitud', id]);
    return resueltas;
  }

  // Paso 2: internet (IA). Acepta un subconjunto de partidas (las que el catálogo no resolvió).
  async function buscarPreciosWeb(soloPartidas = null) {
    if (!sol?.partidas?.length || webSearch.running) return;
    const subset = soloPartidas instanceof Set ? soloPartidas : null;
    const partidas = subset ? sol.partidas.filter((p) => subset.has(p.id)) : sol.partidas;
    if (!partidas.length) return;

    cancelarWebRef.current = false;
    setWebSearch({ running: true, actual: 0, total: partidas.length, resultados: {} });
    for (let i = 0; i < partidas.length; i++) {
      if (cancelarWebRef.current) break;
      const p = partidas[i];
      setWebSearch((prev) => ({ ...prev, actual: i + 1 }));
      try {
        const { data } = await api.post(
          `/solicitudes/${id}/partidas/${p.id}/buscar-precio-web`, {}, { timeout: 300000 }
        );
        setWebSearch((prev) => ({ ...prev, resultados: { ...prev.resultados, [p.id]: { ok: true, ...data } } }));
      } catch (err) {
        setWebSearch((prev) => ({
          ...prev,
          resultados: { ...prev.resultados, [p.id]: { ok: false, error: err.response?.data?.error || 'Error en la búsqueda' } },
        }));
      }
    }
    setWebSearch((prev) => ({ ...prev, running: false }));
    qc.invalidateQueries(['cotprov', id]);
    qc.invalidateQueries(['solicitud', id]);
    toast.success('Búsqueda de precios en internet terminada');
  }

  // Flujo combinado: catálogo primero; internet solo para lo que no se resolvió.
  async function buscarPreciosAuto() {
    if (catSearch.running || webSearch.running) return;
    const resueltas = await buscarPreciosCatalogo();
    const faltan = new Set(sol.partidas.filter((p) => !resueltas.has(p.id)).map((p) => p.id));
    if (faltan.size) {
      toast(`Catálogo resolvió ${resueltas.size} de ${sol.partidas.length}. Buscando el resto en internet…`,
        { icon: '🌐', duration: 5000 });
      await buscarPreciosWeb(faltan);
    } else {
      toast.success('Todas las partidas se resolvieron desde el catálogo');
    }
  }

  // Arranque cuando el usuario pidió explícitamente "Crear y buscar precios web"
  // en la página de Nueva Solicitud (nunca automático por sí solo).
  useEffect(() => {
    if (searchParams.get('buscarWeb') === '1' && sol?.partidas?.length && !autoStartRef.current) {
      autoStartRef.current = true;
      setSearchParams({}, { replace: true });
      toast('Buscando precios: primero en catálogo y luego en internet…',
        { icon: '⚡', duration: 6000 });
      buscarPreciosAuto();
    }
  }, [sol]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <p className="text-gray-400 py-10 text-center">Cargando…</p>;
  if (!sol)      return <p className="text-gray-400 py-10 text-center">Solicitud no encontrada</p>;

  const provYaCotizando = cotProvs.map((c) => c.proveedor_id);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{sol.folio}</h1>
          <p className="text-sm text-gray-500">{sol.cliente_nombre}</p>
        </div>
        <Link to={`/solicitudes/${id}/comparador`} className="btn-primary">
          <BarChart2 size={16} /> Ver comparador
        </Link>
      </div>

      {/* Info */}
      <div className="card grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-gray-500 text-xs mb-0.5">Estatus</p>
          <span className="badge-blue capitalize">{sol.estatus}</span>
        </div>
        <div>
          <p className="text-gray-500 text-xs mb-0.5">Origen</p>
          <p className="font-medium capitalize">{sol.tipo_origen}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs mb-0.5">Referencia cliente</p>
          <p className="font-medium">{sol.referencia_cliente || '—'}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs mb-0.5">Partidas</p>
          <p className="font-medium">{sol.partidas?.length || 0}</p>
        </div>
      </div>

      {/* Tabla de partidas */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <h2 className="font-semibold text-gray-800">Partidas de la solicitud</h2>
          {(() => {
            const sinVincular = sol.partidas?.filter((p) => !p.producto_id).length || 0;
            return sinVincular > 0 ? (
              <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                {sinVincular} {sinVincular === 1 ? 'partida sin vincular' : 'partidas sin vincular'} al catálogo
              </span>
            ) : (
              <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
                Todas las partidas vinculadas
              </span>
            );
          })()}
        </div>
        <p className="text-xs text-gray-400 mb-4">
          La columna <strong>IVA</strong> indica si se calcula IVA (16%) por partida. Por defecto se calcula; desmárcala para dejarla exenta.
          El <strong>SKU interno</strong> vincula con tu catálogo (necesario para inventario, recepción y entrega).
        </p>
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>#</th>
              <th>Código cliente</th>
              <th>Descripción original</th>
              <th>Cant.</th>
              <th>U/M</th>
              <th className="text-center" title="Marca para calcular IVA (16%)">IVA</th>
              <th>SKU interno</th>
              <th>Observaciones</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sol.partidas?.map((p) => {
              const enEdicion = editRow?.id === p.id;
              return (
              <tr key={p.id} className={enEdicion ? 'bg-brand-50/40' : ''}>
                <td className="text-center text-gray-400">{p.linea}</td>
                <td className="font-mono text-xs text-gray-600">{p.codigo_cliente || '—'}</td>
                <td className="max-w-xs">
                  {enEdicion ? (
                    <input className="input text-xs" value={editRow.descripcion_original}
                      onChange={(e) => setEditRow((r) => ({ ...r, descripcion_original: e.target.value }))} />
                  ) : p.descripcion_original}
                </td>
                <td className="text-right">
                  {enEdicion ? (
                    <input type="text" inputMode="decimal" className="input text-xs text-right w-24"
                      value={editRow.cantidad}
                      onChange={(e) => setEditRow((r) => ({ ...r, cantidad: e.target.value }))} />
                  ) : Number(p.cantidad).toLocaleString('es-MX')}
                </td>
                <td>
                  {enEdicion ? (
                    <input className="input text-xs w-20" value={editRow.unidad_medida}
                      onChange={(e) => setEditRow((r) => ({ ...r, unidad_medida: e.target.value }))} />
                  ) : p.unidad_medida}
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-500 cursor-pointer"
                    checked={getIvaExento(p) === 0}
                    onChange={() => toggleIva(p)}
                    title={getIvaExento(p) === 0 ? 'Sí calcula IVA (16%)' : 'Exento — no calcula IVA'} />
                </td>
                <td className="font-mono text-xs">
                  {p.producto_id ? (
                    <span className="flex items-center gap-1">
                      {p.match_estado === 'sugerido'
                        ? <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Auto-vinculado por código — verifica" />
                        : <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Vínculo confirmado" />}
                      <span className={p.match_estado === 'sugerido' ? 'text-amber-600' : 'text-green-600'}>
                        {p.sku_interno || '✓'}
                      </span>
                      <button title="Cambiar" onClick={() => setPicker(p)}
                        className="text-gray-300 hover:text-brand-500"><Pencil size={12} /></button>
                      <button title="Quitar vínculo"
                        onClick={() => vincularMut.mutate({ pid: p.id, data: { producto_id: null } })}
                        className="text-gray-300 hover:text-red-500"><X size={12} /></button>
                    </span>
                  ) : (
                    <button onClick={() => setPicker(p)}
                      className="text-brand-500 hover:underline flex items-center gap-1">
                      <Link2 size={12} /> Vincular
                    </button>
                  )}
                </td>
                <td className="text-gray-500 text-xs">
                  {enEdicion ? (
                    <input className="input text-xs" value={editRow.observaciones}
                      onChange={(e) => setEditRow((r) => ({ ...r, observaciones: e.target.value }))} />
                  ) : (p.observaciones || '')}
                </td>
                <td className="whitespace-nowrap">
                  {enEdicion ? (
                    <span className="flex items-center gap-1.5">
                      <button title="Guardar cambios" onClick={guardarEdicion} disabled={editarMut.isPending}
                        className="text-green-600 hover:text-green-700">
                        {editarMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                      </button>
                      <button title="Cancelar" onClick={() => setEditRow(null)}
                        className="text-gray-400 hover:text-red-500"><X size={15} /></button>
                    </span>
                  ) : (
                    <button title="Editar partida (cantidad, descripción, U/M, observaciones)"
                      onClick={() => setEditRow({
                        id: p.id,
                        cantidad: String(p.cantidad ?? ''),
                        descripcion_original: p.descripcion_original || '',
                        unidad_medida: p.unidad_medida || '',
                        observaciones: p.observaciones || '',
                      })}
                      className="text-gray-300 hover:text-brand-500"><Pencil size={15} /></button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Búsqueda automática de precios: 1º catálogo, 2º internet */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Zap size={16} className="text-brand-500" /> Búsqueda automática de precios
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Primero busca en el <b>catálogo de proveedores</b> (gratis e inmediato); lo que no
              encuentre lo busca en <b>internet con IA</b> (tiendas que entregan en México).
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {webSearch.running && (
              <button onClick={() => { cancelarWebRef.current = true; }} className="btn-secondary btn-sm">
                Detener
              </button>
            )}
            <button
              onClick={() => buscarPreciosCatalogo()}
              disabled={catSearch.running || webSearch.running}
              className="btn-secondary btn-sm disabled:opacity-50"
            >
              <BookOpen size={14} /> Solo catálogo
            </button>
            <button
              onClick={() => buscarPreciosWeb()}
              disabled={catSearch.running || webSearch.running}
              className="btn-secondary btn-sm disabled:opacity-50"
            >
              <Globe size={14} /> Solo internet
            </button>
            <button
              onClick={buscarPreciosAuto}
              disabled={catSearch.running || webSearch.running}
              className="btn-primary btn-sm disabled:opacity-50"
            >
              <Zap size={14} /> Buscar precios
            </button>
          </div>
        </div>

        {(catSearch.running || Object.keys(catSearch.resultados).length > 0) && (
          <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
            <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
              <BookOpen size={13} className="text-brand-500" /> Catálogo de proveedores
            </p>
            {catSearch.running && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Loader2 size={13} className="animate-spin text-brand-500" />
                Buscando en catálogo {catSearch.actual} de {catSearch.total}…
              </div>
            )}
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {sol.partidas?.filter((p) => catSearch.resultados[p.id]).map((p) => {
                const r = catSearch.resultados[p.id];
                return (
                  <div key={p.id} className="text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                    <span className="font-medium text-gray-700">#{p.linea}</span>
                    <span className="text-gray-500 ml-1">{p.descripcion_original?.substring(0, 60)}…</span>
                    {r.ok ? (
                      r.registradas > 0 ? (
                        <span className="text-green-700 ml-2">
                          ✓ {r.matches.map((m) => `${m.proveedor}: $${Number(m.precio_lista).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`).join(' · ')}
                        </span>
                      ) : r.sugerencias?.length ? (
                        <span className="text-amber-600 ml-2">
                          ⚠ {r.sugerencias.length} sugerencia(s) por descripción (sin vínculo, no registrado)
                        </span>
                      ) : (
                        <span className="text-gray-400 ml-2">— no está en catálogo</span>
                      )
                    ) : (
                      <span className="text-red-500 ml-2">— {r.error}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(webSearch.running || Object.keys(webSearch.resultados).length > 0) && (
          <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
            <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
              <Globe size={13} className="text-brand-500" /> Internet (IA)
            </p>
            {webSearch.running && (
              <div>
                <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                  <span className="flex items-center gap-2">
                    <Loader2 size={13} className="animate-spin text-brand-500" />
                    Buscando partida {webSearch.actual} de {webSearch.total}…
                  </span>
                  <span>{Math.round(((webSearch.actual - 1) / webSearch.total) * 100)}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 transition-all"
                    style={{ width: `${((webSearch.actual - 1) / webSearch.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {sol.partidas?.filter((p) => webSearch.resultados[p.id]).map((p) => {
                const r = webSearch.resultados[p.id];
                return (
                  <div key={p.id} className="text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                    <span className="font-medium text-gray-700">#{p.linea}</span>
                    <span className="text-gray-500 ml-1">{p.descripcion_original?.substring(0, 60)}…</span>
                    {r.ok && r.origen === 'cache' && (
                      <span className="ml-1 inline-block rounded bg-blue-50 text-blue-600 px-1.5 py-0.5 text-[10px] font-medium"
                            title={`Reutilizado de una búsqueda previa (${r.fecha_busqueda}); no consumió búsqueda nueva`}>
                        caché {r.fecha_busqueda}
                      </span>
                    )}
                    {r.ok ? (
                      r.registradas > 0 ? (
                        <div className="mt-1 space-y-0.5">
                          {r.ofertas.map((o, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-green-700">
                              <span>✓ {o.tienda}: ${Number(o.precio_mxn).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                              <a href={o.url} target="_blank" rel="noreferrer"
                                 className="text-brand-500 hover:underline truncate max-w-[200px]">
                                ver página
                              </a>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-amber-600 ml-2">— sin precios en México</span>
                      )
                    ) : (
                      <span className="text-red-500 ml-2">— {r.error}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Selección de proveedores y partidas */}
      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold text-gray-800 mb-1">Seleccionar proveedores a cotizar</h2>
          <p className="text-xs text-gray-400 mb-3">
            Elige los proveedores y luego selecciona qué productos enviarles.
          </p>
          <div className="flex flex-wrap gap-2">
            {proveedores.filter((p) => p.activo).map((p) => {
              const yaCotiza = provYaCotizando.includes(p.id);
              const sel = selProvs.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => !yaCotiza && toggleProv(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                    ${yaCotiza
                      ? 'bg-green-50 border-green-200 text-green-700 cursor-default'
                      : sel
                        ? 'bg-brand-500 border-brand-500 text-white'
                        : 'bg-white border-gray-200 text-gray-700 hover:border-brand-300'}`}
                >
                  {p.nombre_empresa}{yaCotiza && ' ✓'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selección de partidas (visible solo si hay proveedores seleccionados) */}
        {selProvs.length > 0 && (
          <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">¿Qué productos enviar a cotizar?</p>
                <p className="text-xs text-gray-400">
                  Desmarca los productos que NO quieres enviar a estos proveedores.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={seleccionarTodasPartidas}
                  className="text-xs text-brand-500 hover:underline flex items-center gap-1"
                >
                  <CheckSquare size={13} /> Todas
                </button>
                <button
                  onClick={() => setSelPartidas([])}
                  className="text-xs text-gray-400 hover:underline flex items-center gap-1"
                >
                  <Square size={13} /> Ninguna
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-1 max-h-64 overflow-y-auto">
              {sol.partidas?.map((p) => {
                const sel = isPartidaSel(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-start gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors
                      ${sel ? 'bg-white border border-brand-200' : 'bg-gray-100 border border-transparent opacity-60'}`}
                  >
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => togglePartida(p.id)}
                      className="mt-0.5 w-4 h-4 accent-brand-500 shrink-0"
                    />
                    <span className="text-xs">
                      <span className="font-medium text-gray-700">#{p.linea}</span>
                      {p.codigo_cliente && (
                        <span className="text-gray-400 ml-1">[{p.codigo_cliente}]</span>
                      )}
                      <span className="ml-1 text-gray-600">{p.descripcion_original}</span>
                      <span className="text-gray-400 ml-1">
                        — {Number(p.cantidad).toLocaleString('es-MX')} {p.unidad_medida}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {selPartidas === null
                  ? `Todas las partidas (${sol.partidas?.length})`
                  : `${selPartidas.length} de ${sol.partidas?.length} partidas seleccionadas`}
              </p>
              <button
                onClick={iniciar}
                disabled={!selProvs.length || iniciarMut.isPending ||
                  (selPartidas !== null && selPartidas.length === 0)}
                className="btn-primary btn-sm"
              >
                <Send size={14} />
                Iniciar cotización con {selProvs.length} proveedor{selProvs.length !== 1 ? 'es' : ''}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Proveedores ya consultados */}
      {cotProvs.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-3">Proveedores consultados</h2>
          <div className="space-y-2">
            {cotProvs.map((cp) => (
              <div key={cp.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <p className="text-sm font-medium">{cp.proveedor}</p>
                  <p className="text-xs text-gray-400">
                    {cp.partidas_incluidas
                      ? `${cp.partidas_incluidas.length} partidas · `
                      : 'Todas las partidas · '}
                    {cp.estatus === 'recibida'
                      ? `Respondió el ${new Date(cp.fecha_respuesta).toLocaleDateString('es-MX')}`
                      : 'Pendiente de respuesta'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cp.estatus === 'recibida' ? 'badge-green' : 'badge-yellow'}>
                    {cp.estatus}
                  </span>
                  <Link
                    to={`/solicitudes/${id}/proveedores/${cp.id}`}
                    className="btn-secondary btn-sm"
                  >
                    {cp.estatus === 'recibida' ? 'Ver / Editar precios' : 'Registrar precios'}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Selector de producto del catálogo ── */}
      {picker && (
        <ProductoPicker
          open
          onClose={() => setPicker(null)}
          partida={picker}
          clienteId={sol.cliente_id}
          onSelect={(c) => vincularMut.mutate({
            pid: picker.id,
            data: {
              producto_id: c.id,
              match_score: c.score != null ? Number((c.score / 100).toFixed(3)) : undefined,
              codigo_cliente: picker.codigo_cliente || undefined,
              descripcion_original: picker.descripcion_original,
            },
          })}
        />
      )}
    </div>
  );
}
