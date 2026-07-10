import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, ShoppingCart } from 'lucide-react';
import api from '../../services/api';

const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export default function CrearPedido() {
  const { cotizacionId } = useParams();
  const navigate = useNavigate();
  const [sel, setSel] = useState({});   // ccpId -> { incluir, cantidad }

  const { data: cot, isLoading } = useQuery({
    queryKey: ['cotizacion', cotizacionId],
    queryFn: () => api.get(`/cotizaciones-cliente/${cotizacionId}`).then((r) => r.data),
  });

  useEffect(() => {
    if (cot?.partidas) {
      const init = {};
      cot.partidas.forEach((p) => { init[p.id] = { incluir: true, cantidad: Number(p.cantidad) }; });
      setSel(init);
    }
  }, [cot]);

  const mut = useMutation({
    mutationFn: (body) => api.post('/ventas/pedidos', body),
    onSuccess: (res) => { toast.success(`Pedido ${res.data.folio} creado`); navigate(`/ventas/pedidos/${res.data.id}`); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  function crear() {
    const incluidas = (cot.partidas || []).filter((p) => sel[p.id]?.incluir && Number(sel[p.id]?.cantidad) > 0);
    const excedidas = incluidas.filter((p) => Number(sel[p.id].cantidad) > Number(p.cantidad));
    if (excedidas.length) {
      return toast.error(`La cantidad asignada excede lo cotizado en: ${excedidas.map((p) => `#${p.linea}`).join(', ')}`);
    }
    const partidas = incluidas.map((p) => ({ cotizacion_partida_id: p.id, cantidad_asignada: Number(sel[p.id].cantidad) }));
    if (!partidas.length) return toast.error('Selecciona al menos una partida con cantidad');
    mut.mutate({ cotizacion_id: Number(cotizacionId), partidas });
  }

  if (isLoading) return <p className="text-gray-400 text-center py-10">Cargando…</p>;
  if (!cot) return <p className="text-gray-400 text-center py-10">Cotización no encontrada</p>;

  const totalSel = (cot.partidas || []).filter((p) => sel[p.id]?.incluir).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-700"><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Asignación del cliente</h1>
          <p className="text-sm text-gray-500">{cot.folio} · {cot.cliente_razon_social}</p>
        </div>
        <button onClick={crear} disabled={mut.isPending} className="btn-primary">
          {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <ShoppingCart size={15} />}
          Crear pedido ({totalSel})
        </button>
      </div>

      <div className="card overflow-x-auto">
        <p className="text-xs text-gray-400 mb-3">Marca las partidas que el cliente asignó y ajusta la cantidad a comprar.</p>
        <table className="table-auto w-full text-sm">
          <thead>
            <tr>
              <th className="w-8"></th>
              <th>#</th><th>Descripción</th>
              <th className="text-center">Cotizado</th>
              <th className="text-center">Asignado</th>
              <th className="text-right">P. Unitario</th>
            </tr>
          </thead>
          <tbody>
            {cot.partidas?.map((p) => {
              const s = sel[p.id] || { incluir: false, cantidad: 0 };
              return (
                <tr key={p.id} className={s.incluir ? '' : 'opacity-50'}>
                  <td className="text-center">
                    <input type="checkbox" className="h-4 w-4 accent-brand-500"
                      checked={!!s.incluir}
                      onChange={(e) => setSel((x) => ({ ...x, [p.id]: { ...s, incluir: e.target.checked } }))} />
                  </td>
                  <td className="text-center text-gray-400">{p.linea}</td>
                  <td>
                    <p className="font-medium">{p.descripcion}</p>
                    {p.sku_interno && <p className="text-xs text-gray-400">SKU: {p.sku_interno}</p>}
                  </td>
                  <td className="text-center">{Number(p.cantidad).toLocaleString('es-MX')} {p.unidad_medida}</td>
                  <td className="text-center">
                    <input type="number" min="0" max={Number(p.cantidad)} step="0.01" className="input w-24 text-center text-sm"
                      value={s.cantidad} disabled={!s.incluir}
                      onChange={(e) => setSel((x) => ({ ...x, [p.id]: { ...s, cantidad: e.target.value } }))} />
                  </td>
                  <td className="text-right">{fmt(p.precio_unitario_venta)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
