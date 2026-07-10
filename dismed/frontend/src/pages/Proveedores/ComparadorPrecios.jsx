import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, RefreshCw, FileText, Loader2, Pencil, Check, X } from 'lucide-react';
import api from '../../services/api';

const fmt = (n) =>
  n == null
    ? <span className="text-gray-300 text-xs">N/D</span>
    : Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function PrecioCell({ prov, pr, cotProvs, partidaId, solicitudId, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [valor, setValor]     = useState('');
  const [saving, setSaving]   = useState(false);

  function startEdit() {
    setValor(pr?.precio_unitario != null ? String(pr.precio_unitario) : '');
    setEditing(true);
  }

  async function save() {
    const cp = cotProvs.find((c) => c.proveedor === prov);
    if (!cp) return;
    setSaving(true);
    try {
      await api.patch(`/cotizaciones-proveedor/${cp.id}/precios/${partidaId}`, {
        precio_unitario: parseFloat(valor) || null,
        disponible:      valor !== '' && parseFloat(valor) > 0,
      });
      toast.success('Precio actualizado');
      onSaved();
    } catch { toast.error('Error al guardar'); }
    finally { setSaving(false); setEditing(false); }
  }

  if (!pr) return <td className="px-3 py-2 text-center text-gray-300">—</td>;

  if (!pr.disponible) {
    return (
      <td className="px-3 py-2 text-center">
        <div className="flex items-center justify-center gap-1">
          <span className="badge-red">No disp.</span>
          <button onClick={startEdit} className="text-gray-400 hover:text-brand-500"><Pencil size={11}/></button>
        </div>
      </td>
    );
  }

  if (editing) {
    return (
      <td className="px-2 py-1">
        <div className="flex items-center gap-1">
          <input autoFocus type="number" min="0" step="0.01"
            className="input text-xs text-right w-24" value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          />
          <button onClick={save} disabled={saving} className="text-green-600 hover:text-green-700">
            {saving ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}
          </button>
          <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-red-500">
            <X size={13}/>
          </button>
        </div>
      </td>
    );
  }

  return (
    <td className={`px-3 py-2 text-center font-medium
      ${pr.es_mejor_precio ? 'bg-green-50 text-green-700' : 'text-gray-700'}`}>
      <div className="flex items-center justify-center gap-1">
        {pr.es_mejor_precio && <span className="text-green-500">★</span>}
        <span>{Number(pr.precio_unitario).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
        <button onClick={startEdit} className="text-gray-300 hover:text-brand-500"><Pencil size={11}/></button>
      </div>
      {pr.sku_proveedor && <p className="text-gray-400 font-normal text-xs">{pr.sku_proveedor}</p>}
      {pr.observaciones_proveedor && <p className="text-gray-400 font-normal text-xs italic">{pr.observaciones_proveedor}</p>}
    </td>
  );
}

export default function ComparadorPrecios() {
  const { id: solicitudId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: sol } = useQuery({
    queryKey: ['solicitud', solicitudId],
    queryFn: () => api.get(`/solicitudes/${solicitudId}`).then((r) => r.data),
  });

  const { data: comparador = [], isLoading } = useQuery({
    queryKey: ['comparador', solicitudId],
    queryFn: () => api.get(`/solicitudes/${solicitudId}/comparador`).then((r) => r.data),
  });

  const { data: cotProvs = [] } = useQuery({
    queryKey: ['cotprov', solicitudId],
    queryFn: () => api.get(`/cotizaciones-proveedor/solicitud/${solicitudId}`).then((r) => r.data),
  });

  // Márgenes como texto (captura libre); se parsean al construir el payload.
  const [margenGlobal, setMargenGlobal] = useState('20');
  const [margenPorPartida, setMargenPorPartida] = useState({});
  // Override local del flag IVA por partida (1 = exento / no calcula IVA, 0 = sí calcula)
  const [ivaExentoOverride, setIvaExentoOverride] = useState({});

  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

  // Cargar factor_ganancia de la solicitud como margen por defecto
  useEffect(() => {
    if (sol?.factor_ganancia != null) {
      setMargenGlobal(String(Math.round(Number(sol.factor_ganancia) * 100 * 100) / 100));
    }
  }, [sol]);

  function getMargenPartida(partidaId) {
    return margenPorPartida[partidaId] ?? margenGlobal;
  }

  function setMargenPartida(partidaId, val) {
    setMargenPorPartida((prev) => ({ ...prev, [partidaId]: val }));
  }

  // IVA: 1 = exento (NO calcula IVA), 0 = sí calcula. Default = calcular (0).
  function getIvaExento(p) {
    return ivaExentoOverride[p.id] ?? p.iva_exento ?? 0;
  }

  const ivaMut = useMutation({
    mutationFn: ({ pid, iva_exento }) =>
      api.put(`/solicitudes/${solicitudId}/partidas/${pid}`, { iva_exento }),
    onError: () => toast.error('No se pudo guardar el ajuste de IVA'),
  });

  function toggleIva(p) {
    const nuevo = getIvaExento(p) ? 0 : 1; // alterna exento
    setIvaExentoOverride((prev) => ({ ...prev, [p.id]: nuevo }));
    ivaMut.mutate({ pid: p.id, iva_exento: nuevo });
  }

  const calcularMut = useMutation({
    mutationFn: () => api.post(`/cotizaciones-proveedor/solicitud/${solicitudId}/calcular`),
    onSuccess: () => {
      toast.success('Mejor precio calculado y marcado');
      qc.invalidateQueries(['comparador', solicitudId]);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  // Pivot: partida → proveedor → precio
  const proveedores = [...new Set(comparador.map((r) => r.proveedor))].sort();
  const partidas    = [];
  const partidasMap = new Map();

  comparador.forEach((row) => {
    if (!partidasMap.has(row.partida_id)) {
      const p = {
        id: row.partida_id, linea: row.linea,
        descripcion_original: row.descripcion_original,
        codigo_cliente:       row.codigo_cliente,
        producto_id:          row.producto_id ?? null,
        sku_interno:          row.sku_interno ?? null,
        cantidad:             row.cantidad,
        unidad_medida:        row.unidad_medida,
        observaciones:        row.observaciones,
        iva_exento:           Number(row.iva_exento) ? 1 : 0,
        precios:              {},
      };
      partidasMap.set(row.partida_id, p);
      partidas.push(p);
    }
    const p = partidasMap.get(row.partida_id);
    if (row.proveedor) {
      p.precios[row.proveedor] = {
        precio_unitario:         row.precio_unitario,
        disponible:              row.disponible,
        es_mejor_precio:         row.es_mejor_precio,
        sku_proveedor:           row.sku_proveedor,
        observaciones_proveedor: row.observaciones_proveedor,
      };
    }
  });

  function buildPartidas() {
    return partidas.map((p) => {
      const mejor = Object.values(p.precios).find((pr) => pr.es_mejor_precio && pr.disponible);
      return {
        partida_solicitud_id: p.id,
        producto_id:          p.producto_id || null,
        sku_interno:          p.sku_interno || null,
        linea:                p.linea,
        descripcion:          p.descripcion_original,
        codigo_cliente:       p.codigo_cliente,
        cantidad:             Number(p.cantidad),
        unidad_medida:        p.unidad_medida,
        observaciones:        p.observaciones || null,
        precio_compra:        parseFloat(mejor?.precio_unitario) || 0,
        margen_pct:           num(getMargenPartida(p.id)),
        iva_exento:           getIvaExento(p),
      };
    });
  }

  const crearCotMut = useMutation({
    mutationFn: () =>
      api.post('/cotizaciones-cliente', {
        solicitud_id: parseInt(solicitudId),
        partidas:     buildPartidas(),
      }),
    onSuccess: (res) => {
      toast.success(`Cotización ${res.data.folio} creada`);
      navigate(`/cotizaciones/${res.data.id}`);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al crear cotización'),
  });

  const hayMejores = comparador.some((r) => r.es_mejor_precio);

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20}/>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Comparador de precios</h1>
          <p className="text-sm text-gray-500">
            {sol?.folio} · {sol?.cliente_nombre}
            {sol?.referencia_cliente && <> · <span className="font-medium">COC: {sol.referencia_cliente}</span></>}
          </p>
        </div>
        <button onClick={() => calcularMut.mutate()} disabled={calcularMut.isPending} className="btn-secondary">
          {calcularMut.isPending ? <Loader2 size={15} className="animate-spin"/> : <RefreshCw size={15}/>}
          Recalcular mejor precio
        </button>
      </div>

      {/* ── Margen (SIEMPRE VISIBLE) + botón crear (solo cuando hay mejores) ── */}
      <div className="card flex items-end gap-4 flex-wrap">
        <div>
          <label className="label">Margen de ganancia global (%)</label>
          <input
            type="number" className="input w-28" value={margenGlobal}
            min="0" max="200" step="0.5"
            onChange={(e) => setMargenGlobal(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">
            {sol?.factor_ganancia != null
              ? `Del Excel: ${Math.round(Number(sol.factor_ganancia) * 100)}% — puedes ajustarlo aquí`
              : 'Puedes ajustarlo por partida en el siguiente paso'}
          </p>
        </div>
        {hayMejores && (
          <button
            onClick={() => crearCotMut.mutate()}
            disabled={crearCotMut.isPending}
            className="btn-primary"
          >
            {crearCotMut.isPending
              ? <><Loader2 size={15} className="animate-spin"/> Creando…</>
              : <><FileText size={15}/> Crear cotización con {num(margenGlobal)}% de margen</>}
          </button>
        )}
        {!hayMejores && partidas.length > 0 && (
          <p className="text-xs text-amber-600">Presiona «Recalcular mejor precio» para habilitar la cotización</p>
        )}
      </div>

      {/* ── Proveedores pendientes ── */}
      {cotProvs.some((c) => c.estatus !== 'recibida') && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-800 flex flex-wrap gap-x-6 gap-y-1">
          <strong>Pendientes de respuesta:</strong>
          {cotProvs.filter((c) => c.estatus !== 'recibida').map((c) => (
            <Link key={c.id} to={`/solicitudes/${solicitudId}/proveedores/${c.id}`}
              className="underline hover:text-yellow-900">{c.proveedor}</Link>
          ))}
        </div>
      )}

      {/* ── Tabla comparativa ── */}
      {isLoading ? (
        <p className="text-gray-400 text-center py-10">Cargando comparador…</p>
      ) : partidas.length === 0 ? (
        <div className="card text-center py-10 text-gray-400">
          <p>No hay precios registrados aún.</p>
          <p className="text-sm mt-1">Regresa a la solicitud y registra precios de al menos un proveedor.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <p className="text-xs text-gray-400 mb-3">
            Haz clic en <Pencil size={10} className="inline"/> para editar un precio. ★ = mejor precio.
          </p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left font-semibold text-gray-500 border-b border-gray-200 w-6">#</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 border-b border-gray-200">Descripción / Observación</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-500 border-b border-gray-200 w-14">Cant.</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-500 border-b border-gray-200 w-20">% Margen</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-500 border-b border-gray-200 w-16" title="Marca para calcular IVA (16%) a esta partida">IVA 16%</th>
                {proveedores.map((prov) => (
                  <th key={prov} className="px-3 py-2 text-center font-semibold text-gray-500 border-b border-gray-200 min-w-[130px]">
                    {prov}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partidas.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-center text-gray-400">{p.linea}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-800">{p.descripcion_original}</p>
                    {p.codigo_cliente && <p className="text-gray-400">Ref: {p.codigo_cliente}</p>}
                    {p.observaciones && p.observaciones !== 'NO COTIZO' && (
                      <p className="text-brand-500 text-xs italic">{p.observaciones}</p>
                    )}
                    {p.observaciones === 'NO COTIZO' && (
                      <p className="text-amber-500 text-xs font-medium">NO COTIZO</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-600">
                    {Number(p.cantidad).toLocaleString('es-MX')} {p.unidad_medida}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="number" min="0" max="200" step="0.5"
                      className={`input text-xs text-center w-16 ${margenPorPartida[p.id] != null ? 'border-brand-400 bg-brand-50' : ''}`}
                      value={getMargenPartida(p.id)}
                      onChange={(e) => setMargenPartida(p.id, e.target.value)}
                      title="Margen individual para esta partida"
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-500 cursor-pointer"
                      checked={getIvaExento(p) === 0}
                      onChange={() => toggleIva(p)}
                      title={getIvaExento(p) === 0 ? 'Sí calcula IVA (16%)' : 'Exento — no calcula IVA'}
                    />
                  </td>
                  {proveedores.map((prov) => (
                    <PrecioCell key={prov} prov={prov} pr={p.precios[prov]}
                      cotProvs={cotProvs} partidaId={p.id}
                      solicitudId={solicitudId} onSaved={() => qc.invalidateQueries(['comparador', solicitudId])}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
