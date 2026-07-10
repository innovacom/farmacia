import { useState, useEffect } from 'react';
import { X, Search, Loader2, Link2, Sparkles } from 'lucide-react';
import api from '../../services/api';

/**
 * Modal para vincular una partida de la solicitud con un producto del catálogo.
 * Al abrir muestra sugerencias basadas en la descripción/código de la partida;
 * el usuario puede teclear para buscar libremente. La similitud de descripción
 * es SUGERENCIA — el usuario confirma; verifica medidas antes de vincular.
 *
 * Props:
 *   open, onClose
 *   partida   { descripcion_original, codigo_cliente }
 *   clienteId (para el diccionario codigo_cliente → producto)
 *   onSelect(producto)  producto = { id, sku_interno, descripcion, ... }
 */
export default function ProductoPicker({ open, onClose, partida, clienteId, onSelect }) {
  const [q, setQ] = useState('');
  const [cands, setCands] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ia, setIa] = useState(null);          // { producto_id, confianza, justificacion }
  const [iaLoading, setIaLoading] = useState(false);

  // Reset al abrir (la búsqueda la dispara el efecto de abajo, una sola vez)
  useEffect(() => {
    if (!open) return;
    setQ('');
    setIa(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Búsqueda única: inmediata al abrir (sugerencias), con debounce al teclear
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => buscar(q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function buscar(texto) {
    setLoading(true);
    try {
      const params = {};
      if (texto && texto.trim()) {
        params.q = texto.trim();
      } else {
        if (partida?.descripcion_original) params.descripcion = partida.descripcion_original;
        if (partida?.codigo_cliente)       params.codigo_cliente = partida.codigo_cliente;
        if (clienteId)                     params.cliente_id = clienteId;
      }
      const { data } = await api.get('/productos/match', { params });
      setCands(data.candidatos || []);
    } catch {
      setCands([]);
    } finally {
      setLoading(false);
    }
  }

  // Desempate con IA: elige de la lista cerrada de candidatos (sigue siendo sugerencia)
  async function desempatarIa() {
    if (!partida?.descripcion_original) return;
    setIaLoading(true);
    setIa(null);
    try {
      const { data } = await api.post('/productos/match-ia', {
        descripcion: partida.descripcion_original,
        codigo_cliente: partida.codigo_cliente || undefined,
        codigo_gobierno: partida.codigo_gobierno || undefined,
        cliente_id: clienteId || undefined,
      });
      if (Array.isArray(data.candidatos) && data.candidatos.length) setCands(data.candidatos);
      setIa(data.eleccion || { producto_id: null, confianza: 'baja', justificacion: 'Sin elección.' });
    } catch {
      setIa({ producto_id: null, confianza: 'baja', justificacion: 'No se pudo consultar la IA.' });
    } finally {
      setIaLoading(false);
    }
  }

  if (!open) return null;

  const badgeCls = (s) =>
    s >= 85 ? 'bg-green-100 text-green-700'
      : s >= 60 ? 'bg-amber-100 text-amber-700'
        : 'bg-gray-100 text-gray-500';

  const reasonLabel = {
    codigo_cliente: 'código cliente',
    codigo_cliente_sugerido: 'código cliente (sin confirmar)',
    ean: 'EAN',
    codigo_gobierno: 'clave de gobierno',
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-16">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[82vh] flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Vincular producto del catálogo</h2>
            {partida?.descripcion_original && (
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                Solicitud: {partida.descripcion_original}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 ml-3 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              className="input pl-9"
              placeholder="Buscar por SKU o descripción…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5 gap-2">
            <p className="text-xs text-gray-400">
              Sugerencias por descripción. <strong>Verifica medidas y presentación</strong> antes de vincular.
            </p>
            <button
              type="button"
              onClick={desempatarIa}
              disabled={iaLoading || !partida?.descripcion_original}
              className="shrink-0 text-xs text-violet-600 hover:text-violet-700 flex items-center gap-1 disabled:opacity-40"
              title="La IA elige el mejor candidato de esta lista (no inventa productos)"
            >
              {iaLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Desempatar con IA
            </button>
          </div>
          {ia && (
            <div className="mt-2 text-xs rounded-lg px-3 py-2 bg-violet-50 border border-violet-100 text-violet-800">
              {ia.producto_id
                ? <><strong>IA sugiere</strong> el resaltado · confianza {ia.confianza}.</>
                : <><strong>IA no encontró</strong> una coincidencia segura.</>}
              {ia.justificacion && <span className="text-violet-500"> {ia.justificacion}</span>}
            </div>
          )}
        </div>

        <div className="overflow-y-auto px-3 py-2 flex-1">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">
              <Loader2 size={16} className="animate-spin inline mr-1" /> Buscando…
            </p>
          ) : cands.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              Sin coincidencias. Ajusta la búsqueda o deja la partida sin vincular.
            </p>
          ) : (
            cands.map((c) => {
              const elegidoIa = ia && ia.producto_id === c.id;
              return (
              <button
                key={c.id}
                onClick={() => { onSelect(c); onClose(); }}
                className={`w-full text-left px-3 py-2.5 rounded-lg hover:bg-brand-50 border flex items-start gap-3 transition-colors ${
                  elegidoIa ? 'border-violet-300 bg-violet-50/60 ring-1 ring-violet-200' : 'border-transparent hover:border-brand-200'}`}
              >
                <Link2 size={15} className="text-brand-400 mt-1 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-brand-600">{c.sku_interno}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${badgeCls(c.score)}`}>
                      {c.score}%
                    </span>
                    {reasonLabel[c.match_reason] && (
                      <span className="text-[10px] text-green-600">{reasonLabel[c.match_reason]}</span>
                    )}
                    {elegidoIa && (
                      <span className="text-[10px] text-violet-600 flex items-center gap-0.5">
                        <Sparkles size={10} /> IA
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 break-words">{c.descripcion}</p>
                  {c.fabricante && <p className="text-xs text-gray-400">{c.fabricante}</p>}
                </div>
              </button>
              );
            })
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="btn-secondary btn-sm">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
