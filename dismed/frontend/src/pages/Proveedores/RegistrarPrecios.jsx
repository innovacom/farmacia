import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import api from '../../services/api';

export default function RegistrarPrecios() {
  const { id: solicitudId, cpId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: sol } = useQuery({
    queryKey: ['solicitud', solicitudId],
    queryFn: () => api.get(`/solicitudes/${solicitudId}`).then((r) => r.data),
  });

  const { data: cotProvs = [] } = useQuery({
    queryKey: ['cotprov', solicitudId],
    queryFn: () => api.get(`/cotizaciones-proveedor/solicitud/${solicitudId}`).then((r) => r.data),
  });

  const cotActual = cotProvs.find((c) => c.id === parseInt(cpId));
  const [precios, setPrecios] = useState({});

  // Partidas filtradas: si el proveedor tiene selección, mostrar solo esas
  const partidasFiltradas = (() => {
    if (!sol?.partidas) return [];
    const incluidas = cotActual?.partidas_incluidas; // array de ids o null
    if (!incluidas) return sol.partidas;
    return sol.partidas.filter((p) => incluidas.includes(p.id));
  })();

  useEffect(() => {
    if (!cotActual || !sol?.partidas) return;
    // Solo las partidas enviadas a este proveedor: las demás no deben
    // registrarse como "disponibles" ni aparecer en el comparador.
    const incluidas = cotActual.partidas_incluidas; // array de ids o null (todas)
    const visibles = incluidas
      ? sol.partidas.filter((p) => incluidas.includes(p.id))
      : sol.partidas;
    const init = {};
    visibles.forEach((p) => {
      const existing = cotActual.precios?.find((pr) => pr.partida_id === p.id);
      init[p.id] = {
        sku_proveedor:           existing?.sku_proveedor           || '',
        descripcion_proveedor:   existing?.descripcion_proveedor   || '',
        observaciones_proveedor: existing?.observaciones_proveedor || '',
        precio_unitario:         existing?.precio_unitario         || '',
        disponible:              existing ? existing.disponible : true,
      };
    });
    setPrecios(init);
  }, [cotActual, sol]);

  function setField(partidaId, field, value) {
    setPrecios((prev) => ({
      ...prev,
      [partidaId]: { ...prev[partidaId], [field]: value },
    }));
  }

  const guardarMut = useMutation({
    mutationFn: () => {
      const payload = Object.entries(precios).map(([partida_id, vals]) => ({
        partida_id:              parseInt(partida_id),
        sku_proveedor:           vals.sku_proveedor           || null,
        descripcion_proveedor:   vals.descripcion_proveedor   || null,
        observaciones_proveedor: vals.observaciones_proveedor || null,
        precio_unitario:         vals.disponible ? (parseFloat(vals.precio_unitario) || null) : null,
        disponible:              vals.disponible,
      }));
      return api.put(`/cotizaciones-proveedor/${cpId}/precios`, { precios: payload });
    },
    onSuccess: () => {
      toast.success('Precios registrados correctamente');
      qc.invalidateQueries(['cotprov', solicitudId]);
      navigate(`/solicitudes/${solicitudId}`);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  if (!sol || !cotActual) {
    return <p className="text-gray-400 py-10 text-center">Cargando datos…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Registrar precios</h1>
          <p className="text-sm text-gray-500">
            Proveedor: <strong>{cotActual.proveedor}</strong> · Solicitud: {sol.folio}
            {cotActual.partidas_incluidas && (
              <span className="ml-2 badge-blue">
                {cotActual.partidas_incluidas.length} de {sol.partidas?.length} partidas
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="card">
        <p className="text-sm text-gray-500 mb-4">
          Ingresa el precio unitario (sin IVA). Desmarca <strong>Disp.</strong> si el proveedor
          no cotizó ese producto. El campo <strong>Obs. proveedor</strong> es para anotar marca,
          tiempo de entrega u otras especificaciones del proveedor.
        </p>

        <div className="overflow-x-auto">
          <table className="table-auto w-full text-sm">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th>Descripción del cliente</th>
                <th style={{ width: 70 }}>Cant.</th>
                <th style={{ width: 100 }}>SKU prov.</th>
                <th style={{ width: 130 }}>Descripción prov.</th>
                <th>Obs. proveedor</th>
                <th style={{ width: 110 }}>Precio unit. (MXN)</th>
                <th style={{ width: 55 }}>Disp.</th>
              </tr>
            </thead>
            <tbody>
              {partidasFiltradas.map((p) => {
                const row = precios[p.id] || {};
                const dis = row.disponible !== false;
                return (
                  <tr key={p.id} className={!dis ? 'opacity-50' : ''}>
                    <td className="text-center text-gray-400">{p.linea}</td>
                    <td>
                      <p className="font-medium">{p.descripcion_original}</p>
                      {p.codigo_cliente && (
                        <p className="text-xs text-gray-400">Cód: {p.codigo_cliente}</p>
                      )}
                    </td>
                    <td className="text-right text-gray-600">
                      {Number(p.cantidad).toLocaleString('es-MX')} {p.unidad_medida}
                    </td>
                    <td>
                      <input
                        className="input text-xs"
                        value={row.sku_proveedor || ''}
                        onChange={(e) => setField(p.id, 'sku_proveedor', e.target.value)}
                        placeholder="GL-001"
                        disabled={!dis}
                      />
                    </td>
                    <td>
                      <input
                        className="input text-xs"
                        value={row.descripcion_proveedor || ''}
                        onChange={(e) => setField(p.id, 'descripcion_proveedor', e.target.value)}
                        placeholder="Nombre del proveedor"
                        disabled={!dis}
                      />
                    </td>
                    <td>
                      <input
                        className="input text-xs"
                        value={row.observaciones_proveedor || ''}
                        onChange={(e) => setField(p.id, 'observaciones_proveedor', e.target.value)}
                        placeholder="Marca, entrega, especificaciones…"
                        disabled={!dis}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className={`input text-xs text-right ${!dis ? 'bg-gray-50' : ''}`}
                        value={row.precio_unitario || ''}
                        min="0"
                        step="0.01"
                        onChange={(e) => setField(p.id, 'precio_unitario', e.target.value)}
                        placeholder="0.00"
                        disabled={!dis}
                      />
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={dis}
                        onChange={(e) => setField(p.id, 'disponible', e.target.checked)}
                        className="w-4 h-4 accent-brand-500"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex gap-3 mt-5 pt-4 border-t border-gray-100">
          <button
            onClick={() => guardarMut.mutate()}
            disabled={guardarMut.isPending}
            className="btn-primary"
          >
            {guardarMut.isPending
              ? <><Loader2 size={15} className="animate-spin" /> Guardando…</>
              : <><Save size={15} /> Guardar precios</>
            }
          </button>
          <button onClick={() => navigate(-1)} className="btn-secondary">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
