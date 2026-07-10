import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, FileText } from 'lucide-react';
import api from '../../services/api';

const fmt = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export default function NuevaCotizacion() {
  const { solicitudId } = useParams();
  const navigate = useNavigate();

  const { data: sol } = useQuery({
    queryKey: ['solicitud', solicitudId],
    queryFn: () => api.get(`/solicitudes/${solicitudId}`).then((r) => r.data),
  });

  const { data: comparador = [] } = useQuery({
    queryKey: ['comparador', solicitudId],
    queryFn: () => api.get(`/solicitudes/${solicitudId}/comparador`).then((r) => r.data),
  });

  // Los numéricos se guardan como texto (captura libre) y se parsean al usar.
  const [margenGlobal, setMargenGlobal] = useState('20');
  const [margenes, setMargenes]         = useState({});  // partida_id → override de margen (texto)
  const [partidas, setPartidas]         = useState([]);
  const [condicion, setCondicion]       = useState('Contado');
  const [diasVigencia, setDiasVigencia] = useState('30');
  const [tiempoEntrega, setTiempoEntrega] = useState('3 a 5 días hábiles');
  const [notas, setNotas]               = useState('');

  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

  // Usar factor_ganancia de la solicitud como margen por defecto
  useEffect(() => {
    if (sol?.factor_ganancia != null) {
      setMargenGlobal(String(Math.round(Number(sol.factor_ganancia) * 100 * 100) / 100));
    }
  }, [sol]);

  // Construir partidas desde el comparador (el margen NO vive aquí: cambiar el
  // margen global no debe reconstruir ni pisar los overrides por partida)
  useEffect(() => {
    if (!comparador.length) return;

    const map = new Map();
    comparador.forEach((row) => {
      if (!map.has(row.partida_id)) {
        map.set(row.partida_id, {
          partida_solicitud_id: row.partida_id,
          linea:                row.linea,
          descripcion:          row.descripcion_original,
          codigo_cliente:       row.codigo_cliente,
          cantidad:             row.cantidad,
          unidad_medida:        row.unidad_medida,
          observaciones:        row.observaciones || null,
          iva_exento:           Number(row.iva_exento) ? 1 : 0,
          precio_compra:        0,
        });
      }
      if (row.es_mejor_precio && row.disponible && row.precio_unitario != null) {
        map.get(row.partida_id).precio_compra = parseFloat(row.precio_unitario);
      }
    });

    setPartidas([...map.values()].sort((a, b) => (a.linea || 0) - (b.linea || 0)));
  }, [comparador]);

  // Margen efectivo: override por partida si existe, si no el global
  const getMargenTxt = (id) => margenes[id] ?? margenGlobal;
  const margenDe     = (p)  => num(getMargenTxt(p.partida_solicitud_id));

  function calcPrecioVenta(p) { return p.precio_compra * (1 + margenDe(p) / 100); }
  function calcImporte(p)     { return calcPrecioVenta(p) * Number(p.cantidad); }

  const subtotal = partidas.reduce((acc, p) => acc + calcImporte(p), 0);
  const iva      = partidas.reduce((acc, p) => acc + (p.iva_exento ? 0 : calcImporte(p) * 0.16), 0);
  const total    = subtotal + iva;

  const crearMut = useMutation({
    mutationFn: () =>
      api.post('/cotizaciones-cliente', {
        solicitud_id:   parseInt(solicitudId),
        partidas:       partidas.map((p) => ({
          ...p,
          margen_pct:            margenDe(p),
          precio_unitario_venta: calcPrecioVenta(p),
          importe:               calcImporte(p),
        })),
        condicion_pago: condicion,
        dias_vigencia:  parseInt(diasVigencia, 10) || 30,
        tiempo_entrega: tiempoEntrega,
        notas,
      }),
    onSuccess: (res) => {
      toast.success(`Cotización ${res.data.folio} creada`);
      navigate(`/cotizaciones/${res.data.id}`);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  if (!sol) return <p className="text-gray-400 text-center py-10">Cargando…</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20}/>
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Nueva cotización al cliente</h1>
          <p className="text-sm text-gray-500">
            {sol.folio} · {sol.cliente_nombre}
            {sol.referencia_cliente && <> · <span className="font-medium">COC: {sol.referencia_cliente}</span></>}
          </p>
        </div>
      </div>

      {/* ── Margen y condiciones ── */}
      <div className="card grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="label">Margen global (%)</label>
          <input
            type="number" className="input" value={margenGlobal} min="0" step="0.5"
            onChange={(e) => setMargenGlobal(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">
            {sol.factor_ganancia != null
              ? `Del Excel: ${Number(sol.factor_ganancia) * 100}%`
              : 'Aplica a todas las partidas'}
          </p>
        </div>
        <div>
          <label className="label">Condición de pago</label>
          <select className="input" value={condicion} onChange={(e) => setCondicion(e.target.value)}>
            <option>Contado</option>
            <option>Crédito 15 días</option>
            <option>Crédito 30 días</option>
            <option>Crédito 45 días</option>
            <option>Crédito 60 días</option>
          </select>
        </div>
        <div>
          <label className="label">Tiempo de entrega</label>
          <input className="input" value={tiempoEntrega} onChange={(e) => setTiempoEntrega(e.target.value)}/>
        </div>
        <div>
          <label className="label">Vigencia (días)</label>
          <input type="number" className="input" value={diasVigencia} min="1"
            onChange={(e) => setDiasVigencia(e.target.value)}/>
        </div>
      </div>

      {/* ── Tabla de partidas ── */}
      <div className="card overflow-x-auto">
        <h2 className="font-semibold text-gray-800 mb-4">Partidas y márgenes</h2>
        <table className="table-auto w-full text-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Descripción / Observación</th>
              <th className="text-center">Cant.</th>
              <th className="text-right">P. compra</th>
              <th className="text-center" style={{ width: 90 }}>Margen %</th>
              <th className="text-right">P. Venta</th>
              <th className="text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {partidas.map((p) => (
              <tr key={p.partida_solicitud_id}>
                <td className="text-center text-gray-400">{p.linea}</td>
                <td>
                  <p className="font-medium">{p.descripcion}</p>
                  {p.codigo_cliente && <p className="text-xs text-gray-400">Ref: {p.codigo_cliente}</p>}
                  {p.observaciones && (
                    <p className={`text-xs italic ${p.observaciones === 'NO COTIZO' ? 'text-amber-500' : 'text-gray-400'}`}>
                      {p.observaciones}
                    </p>
                  )}
                </td>
                <td className="text-center">{Number(p.cantidad).toLocaleString('es-MX')} {p.unidad_medida}</td>
                <td className="text-right">
                  {p.precio_compra > 0
                    ? fmt(p.precio_compra)
                    : <span className="text-red-400 text-xs">Sin precio</span>}
                </td>
                <td className="text-center">
                  <input type="number"
                    className={`input text-xs text-center w-20 ${margenes[p.partida_solicitud_id] != null ? 'border-brand-400 bg-brand-50' : ''}`}
                    value={getMargenTxt(p.partida_solicitud_id)} min="0" step="0.5"
                    title="Margen individual para esta partida"
                    onChange={(e) => setMargenes((prev) => ({ ...prev, [p.partida_solicitud_id]: e.target.value }))}
                  />
                </td>
                <td className="text-right font-medium">{fmt(calcPrecioVenta(p))}</td>
                <td className="text-right font-medium">{fmt(calcImporte(p))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
          <table className="text-sm w-56">
            <tbody>
              <tr>
                <td className="py-1 text-gray-500">Subtotal:</td>
                <td className="py-1 text-right font-medium">{fmt(subtotal)}</td>
              </tr>
              <tr>
                <td className="py-1 text-gray-500">IVA (16% partidas gravadas):</td>
                <td className="py-1 text-right font-medium">{fmt(iva)}</td>
              </tr>
              <tr className="border-t border-gray-200">
                <td className="pt-2 font-bold text-brand-500">TOTAL:</td>
                <td className="pt-2 text-right font-bold text-brand-500 text-base">{fmt(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Notas ── */}
      <div className="card">
        <label className="label">Notas adicionales en el PDF</label>
        <textarea className="input min-h-[60px]" placeholder="Precios sujetos a disponibilidad…"
          value={notas} onChange={(e) => setNotas(e.target.value)}/>
      </div>

      <div className="flex gap-3">
        <button onClick={() => crearMut.mutate()} disabled={crearMut.isPending} className="btn-primary">
          {crearMut.isPending
            ? <><Loader2 size={15} className="animate-spin"/> Creando…</>
            : <><FileText size={15}/> Crear cotización</>}
        </button>
        <button onClick={() => navigate(-1)} className="btn-secondary">Cancelar</button>
      </div>
    </div>
  );
}
