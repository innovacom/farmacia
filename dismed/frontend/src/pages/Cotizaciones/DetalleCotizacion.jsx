import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Send, CheckCircle, XCircle, Loader2, ShoppingCart } from 'lucide-react';
import api from '../../services/api';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';

const fmt = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const ESTATUS_BADGE = {
  borrador:  'badge-gray',
  enviada:   'badge-blue',
  aceptada:  'badge-green',
  rechazada: 'badge-red',
  vencida:   'badge-yellow',
};

export default function DetalleCotizacion() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();

  const { data: cot, isLoading } = useQuery({
    queryKey: ['cotizacion', id],
    queryFn: () => api.get(`/cotizaciones-cliente/${id}`).then((r) => r.data),
  });

  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);

  const estatusMut = useMutation({
    mutationFn: (estatus) => api.put(`/cotizaciones-cliente/${id}/estatus`, { estatus }),
    onSuccess: () => {
      toast.success('Estatus actualizado');
      qc.invalidateQueries(['cotizacion', id]);
      qc.invalidateQueries(['cotizaciones']);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  async function generarPdf() {
    setGenerandoPdf(true);
    try {
      const res = await api.get(`/cotizaciones-cliente/${id}/pdf`);
      setPdfUrl(res.data.url);
      toast.success('PDF generado correctamente');
      window.open(res.data.url, '_blank');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Error al generar PDF');
    } finally {
      setGenerandoPdf(false);
    }
  }

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(cot?.partidas || []);

  if (isLoading) return <p className="text-gray-400 text-center py-10">Cargando…</p>;
  if (!cot) return <p className="text-gray-400 text-center py-10">Cotización no encontrada</p>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{cot.folio}</h1>
          <p className="text-sm text-gray-500">{cot.cliente_razon_social}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* PDF */}
          <button onClick={generarPdf} disabled={generandoPdf} className="btn-secondary">
            {generandoPdf
              ? <><Loader2 size={14} className="animate-spin" /> Generando…</>
              : <><Download size={14} /> Generar PDF</>
            }
          </button>
          {/* Cambiar estatus */}
          {cot.estatus === 'borrador' && (
            <button onClick={() => estatusMut.mutate('enviada')} className="btn-primary">
              <Send size={14} /> Marcar enviada
            </button>
          )}
          {cot.estatus === 'enviada' && (
            <>
              <button
                onClick={async () => {
                  if (await confirmar(`¿Marcar la cotización ${cot.folio} como ACEPTADA por el cliente?`,
                    { titulo: 'Aceptar cotización', textoConfirmar: 'Marcar aceptada', danger: false })) {
                    estatusMut.mutate('aceptada');
                  }
                }}
                className="btn-primary"
              >
                <CheckCircle size={14} /> Aceptada
              </button>
              <button
                onClick={async () => {
                  if (await confirmar(`¿Marcar la cotización ${cot.folio} como RECHAZADA?`,
                    { titulo: 'Rechazar cotización', textoConfirmar: 'Marcar rechazada' })) {
                    estatusMut.mutate('rechazada');
                  }
                }}
                className="btn-danger"
              >
                <XCircle size={14} /> Rechazada
              </button>
            </>
          )}
          {(cot.estatus === 'aceptada' || cot.estatus === 'enviada') && (
            <button onClick={() => navigate(`/ventas/pedidos/nuevo/${id}`)} className="btn-primary">
              <ShoppingCart size={14} /> Asignación / Crear pedido
            </button>
          )}
        </div>
      </div>

      {/* Info general */}
      <div className="card grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-gray-400 text-xs mb-0.5">Estatus</p>
          <span className={ESTATUS_BADGE[cot.estatus] || 'badge-gray'}>{cot.estatus}</span>
        </div>
        <div>
          <p className="text-gray-400 text-xs mb-0.5">Solicitud</p>
          <Link to={`/solicitudes/${cot.solicitud_id}`} className="text-brand-500 font-mono text-xs hover:underline">
            {cot.folio_solicitud}
          </Link>
        </div>
        <div>
          <p className="text-gray-400 text-xs mb-0.5">Condición</p>
          <p className="font-medium">{cot.condicion_pago}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs mb-0.5">Vigencia</p>
          <p className="font-medium">{cot.dias_vigencia} días</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs mb-0.5">Tiempo entrega</p>
          <p className="font-medium">{cot.tiempo_entrega}</p>
        </div>
        {cot.referencia_cliente && (
          <div>
            <p className="text-gray-400 text-xs mb-0.5">No. solicitud cliente</p>
            <p className="font-medium">{cot.referencia_cliente}</p>
          </div>
        )}
        {(cot.atencion || cot.contacto_nombre) && (
          <div>
            <p className="text-gray-400 text-xs mb-0.5">Atención</p>
            <p className="font-medium">{cot.atencion || cot.contacto_nombre}</p>
          </div>
        )}
        {cot.concepto && (
          <div>
            <p className="text-gray-400 text-xs mb-0.5">Concepto</p>
            <p className="font-medium">{cot.concepto}</p>
          </div>
        )}
        <div>
          <p className="text-gray-400 text-xs mb-0.5">RFC cliente</p>
          <p className="font-medium font-mono">{cot.cliente_rfc || '—'}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs mb-0.5">Fecha</p>
          <p className="font-medium">{new Date(cot.created_at).toLocaleDateString('es-MX')}</p>
        </div>
      </div>

      {/* Partidas */}
      <div className="card overflow-x-auto">
        <h2 className="font-semibold text-gray-800 mb-4">Partidas</h2>
        <table className="table-auto w-full text-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Descripción</th>
              <th className="text-center">Cant.</th>
              <th className="text-center">U/M</th>
              <th className="text-right">P. Unitario</th>
              <th className="text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((p) => (
              <tr key={p.id}>
                <td className="text-center text-gray-400">{p.linea}</td>
                <td>
                  <p className="font-medium">{p.descripcion}</p>
                  {p.sku_interno && (
                    <p className="text-xs text-gray-400">SKU: {p.sku_interno}</p>
                  )}
                  {p.codigo_cliente && (
                    <p className="text-xs text-gray-400">Ref. cliente: {p.codigo_cliente}</p>
                  )}
                  {p.observaciones && (
                    <p className="text-xs text-amber-600 italic mt-0.5">{p.observaciones}</p>
                  )}
                </td>
                <td className="text-center">{Number(p.cantidad).toLocaleString('es-MX')}</td>
                <td className="text-center">{p.unidad_medida}</td>
                <td className="text-right font-medium">{fmt(p.precio_unitario_venta)}</td>
                <td className="text-right font-medium">{fmt(p.importe)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Pagination page={page} totalPages={totalPages} total={total} from={from} to={to} onChange={setPage} />

        {/* Totales */}
        <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
          <table className="text-sm w-56">
            <tbody>
              <tr>
                <td className="py-1 text-gray-500">Subtotal:</td>
                <td className="py-1 text-right font-medium">{fmt(cot.subtotal)}</td>
              </tr>
              <tr>
                <td className="py-1 text-gray-500">IVA 16%:</td>
                <td className="py-1 text-right font-medium">{fmt(cot.iva)}</td>
              </tr>
              <tr className="border-t border-gray-200">
                <td className="pt-2 font-bold text-brand-500">TOTAL:</td>
                <td className="pt-2 text-right font-bold text-brand-500 text-base">{fmt(cot.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {pdfUrl && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800 flex items-center gap-3">
          <CheckCircle size={16} className="text-green-600 shrink-0" />
          PDF generado —{' '}
          <a href={pdfUrl} target="_blank" rel="noreferrer" className="underline font-medium">
            Abrir / descargar
          </a>
        </div>
      )}

      {dialogoConfirm}
    </div>
  );
}
