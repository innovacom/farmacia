import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { Loader2, CheckCircle, FileUp } from 'lucide-react';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';

export default function CargaFacturas() {
  const qc = useQueryClient();
  const [almacenId, setAlmacenId] = useState('');
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(null); // { comprobante, proveedor, resumen }
  const [renglones, setRenglones] = useState([]);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const { data: almacenes = [] } = useQuery({
    queryKey: ['almacenes'], queryFn: () => api.get('/almacenes').then((r) => r.data),
  });

  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', almacenId],
    queryFn: () => api.get(`/almacenes/${almacenId}/ubicaciones`).then((r) => r.data),
    enabled: !!almacenId,
  });

  const onDrop = async (files) => {
    const file = files[0]; if (!file) return;
    if (!almacenId) return toast.error('Selecciona primero el almacén destino');
    setParsing(true); setPreview(null); setResultado(null);
    try {
      const form = new FormData();
      form.append('archivo', file);
      form.append('almacen_id', almacenId);
      const { data } = await api.post('/inventario/carga-facturas/preview', form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      });
      setPreview(data);
      setRenglones(data.renglones);
      toast.success(`${data.renglones.length} productos leídos del CFDI`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al leer el XML');
    } finally { setParsing(false); }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, maxFiles: 1, disabled: !almacenId,
    accept: { 'text/xml': ['.xml'], 'application/xml': ['.xml'] },
  });

  function actualizarRenglon(linea, campo, valor) {
    setRenglones((rs) => rs.map((r) => (r.linea === linea ? { ...r, [campo]: valor } : r)));
  }

  function toggleControlLote(linea, checked) {
    setRenglones((rs) => rs.map((r) => (r.linea === linea
      ? { ...r, control_lote_caducidad: checked, ...(checked ? {} : { numero_lote: '', fecha_caducidad: '' }) }
      : r)));
  }

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(renglones);

  async function confirmar() {
    if (!almacenId) return toast.error('Selecciona el almacén destino');
    const sinUbicacion = renglones.filter((r) => !r.ubicacion?.toString().trim());
    if (sinUbicacion.length) return toast.error(`Falta ubicación en ${sinUbicacion.length} renglón(es)`);
    const sinLote = renglones.filter((r) => r.control_lote_caducidad && !r.numero_lote?.toString().trim());
    if (sinLote.length) return toast.error(`Falta número de lote en ${sinLote.length} producto(s) con control de caducidad`);

    setConfirmando(true);
    try {
      const { data } = await api.post('/inventario/carga-facturas/confirmar', {
        almacen_id: almacenId,
        proveedor_id: preview.proveedor.id,
        comprobante: preview.comprobante,
        renglones,
      }, { timeout: 300000 });
      setResultado(data);
      toast.success(`Entrada registrada: ${data.importados} importados${data.omitidos ? `, ${data.omitidos} omitidos` : ''}`);
      qc.invalidateQueries(['existencias']);
      qc.invalidateQueries(['kardex']);
      qc.invalidateQueries(['almacenes']);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al registrar la entrada');
    } finally { setConfirmando(false); }
  }

  function nuevaFactura() {
    setPreview(null); setRenglones([]); setResultado(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Carga automática de facturas</h1>
      </div>

      {!preview ? (
        <div className="card max-w-2xl">
          <div className="mb-4">
            <label className="label">Almacén destino *</label>
            <select className="input w-72" value={almacenId} onChange={(e) => setAlmacenId(e.target.value)}>
              <option value="">— Selecciona —</option>
              {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Se leerá el proveedor y los productos del CFDI, y se recibirán en este almacén.
            </p>
          </div>

          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors
              ${!almacenId ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              ${isDragActive ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-300'}`}
          >
            <input {...getInputProps()} />
            {parsing ? (
              <div className="flex flex-col items-center gap-2 text-brand-500">
                <Loader2 size={32} className="animate-spin" /><p>Leyendo factura…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-400">
                <FileUp size={32} />
                <p className="font-medium text-gray-600">Sube el XML (CFDI) de la factura del proveedor</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Encabezado: proveedor + comprobante */}
          <div className="card">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="font-semibold text-gray-900 flex items-center gap-2">
                  {preview.proveedor.nombre_empresa}
                  {preview.proveedor._nuevo && <span className="badge-yellow">proveedor nuevo</span>}
                </p>
                <p className="text-xs text-gray-400">
                  RFC {preview.proveedor.rfc} · Folio {preview.comprobante.serie || ''}{preview.comprobante.folio} · {preview.comprobante.fecha?.slice(0, 10)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">Total del CFDI</p>
                <p className="font-bold text-gray-900">
                  {Number(preview.comprobante.total).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3 text-xs flex-wrap">
              <span className="bg-gray-50 rounded-lg px-3 py-1.5">{preview.resumen.total} productos</span>
              {preview.resumen.nuevos_productos > 0 && (
                <span className="bg-amber-50 text-amber-700 rounded-lg px-3 py-1.5">
                  {preview.resumen.nuevos_productos} nuevos en catálogo — captura su precio abajo para dejarlos vendibles
                </span>
              )}
              {ubicaciones.length === 0 && (
                <span className="bg-red-50 text-red-600 rounded-lg px-3 py-1.5">
                  Este almacén no tiene ubicaciones creadas — créalas primero en Inventario › Almacenes
                </span>
              )}
            </div>
          </div>

          {/* Tabla editable */}
          <div className="card">
            <div className="overflow-x-auto">
              <table className="table-auto w-full text-xs">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Descripción</th>
                    <th className="text-right">Cantidad</th>
                    <th>Ubicación *</th>
                    <th>Lote</th>
                    <th>Caducidad</th>
                    <th className="text-right">Costo unit.</th>
                    <th className="text-right">Precio lista</th>
                    <th className="text-right">Precio público</th>
                    <th>Clasificación COFEPRIS</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((r) => (
                    <tr key={r.linea}>
                      <td className="font-mono text-brand-500 whitespace-nowrap align-top pt-2.5">{r.sku_interno}</td>
                      <td className="max-w-[220px] whitespace-normal break-words align-top pt-2.5">
                        {r.descripcion}
                        {r.producto_nuevo && <span className="badge-yellow ml-1">nuevo</span>}
                      </td>
                      <td className="text-right">
                        <input
                          type="number" min="0" step="0.01" className="input w-20 text-right"
                          value={r.cantidad}
                          onChange={(e) => actualizarRenglon(r.linea, 'cantidad', e.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          className={`input w-32 ${!r.ubicacion?.toString().trim() ? 'border-amber-300' : ''}`}
                          value={r.ubicacion || ''}
                          onChange={(e) => actualizarRenglon(r.linea, 'ubicacion', e.target.value)}
                        >
                          <option value="">— Selecciona —</option>
                          {ubicaciones.map((u) => (
                            <option key={u.id} value={u.codigo}>
                              {u.codigo}{u.descripcion ? ` — ${u.descripcion}` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            className="shrink-0"
                            checked={!!r.control_lote_caducidad}
                            title="Este producto controla lote/caducidad"
                            onChange={(e) => toggleControlLote(r.linea, e.target.checked)}
                          />
                          <input
                            className={`input w-20 font-mono ${r.control_lote_caducidad && !r.numero_lote?.toString().trim() ? 'border-amber-300' : ''}`}
                            value={r.numero_lote}
                            disabled={!r.control_lote_caducidad}
                            placeholder={r.control_lote_caducidad ? 'requerido' : 'N/A'}
                            onChange={(e) => actualizarRenglon(r.linea, 'numero_lote', e.target.value)}
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          type="date" className="input w-32" value={r.fecha_caducidad}
                          disabled={!r.control_lote_caducidad}
                          onChange={(e) => actualizarRenglon(r.linea, 'fecha_caducidad', e.target.value)}
                        />
                      </td>
                      <td className="text-right">
                        <input
                          type="number" min="0" step="0.01" className="input w-24 text-right"
                          value={r.costo_unitario}
                          onChange={(e) => actualizarRenglon(r.linea, 'costo_unitario', e.target.value)}
                        />
                      </td>
                      {r.vendible ? (
                        <td colSpan={3} className="align-top pt-2.5">
                          <span className="badge-green">Ya vendible</span>
                        </td>
                      ) : (
                        <>
                          <td className="text-right">
                            <input
                              type="number" min="0" step="0.01" className="input w-24 text-right"
                              value={r.precio_lista}
                              placeholder="Capturar"
                              onChange={(e) => actualizarRenglon(r.linea, 'precio_lista', e.target.value)}
                            />
                          </td>
                          <td className="text-right">
                            <input
                              type="number" min="0" step="0.01" className="input w-24 text-right"
                              value={r.precio_publico}
                              placeholder="Opcional"
                              onChange={(e) => actualizarRenglon(r.linea, 'precio_publico', e.target.value)}
                            />
                          </td>
                          <td>
                            {r.producto_nuevo ? (
                              <select
                                className="input w-40"
                                value={r.clasificacion_cofepris || 'libre'}
                                onChange={(e) => actualizarRenglon(r.linea, 'clasificacion_cofepris', e.target.value)}
                              >
                                <option value="libre">Venta libre</option>
                                <option value="venta_farmacia">Venta en farmacia s/receta</option>
                                <option value="antibiotico">Antibiótico — receta retenida</option>
                                <option value="fraccion_iii">Fracción III</option>
                                <option value="fraccion_ii">Fracción II</option>
                                <option value="fraccion_i">Fracción I</option>
                              </select>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} total={total} from={from} to={to} onChange={setPage} />
          </div>

          {resultado && (
            <div className="card">
              <p className="text-sm flex items-center gap-2">
                <CheckCircle size={16} className="text-green-600" />
                <strong>{resultado.importados}</strong> renglones importados
                {resultado.omitidos ? `, ${resultado.omitidos} omitidos` : ''}.
              </p>
              {resultado.errores?.length > 0 && (
                <ul className="text-xs text-red-600 mt-2 space-y-0.5">
                  {resultado.errores.map((e, i) => <li key={i}>{e.sku}: {e.motivo}</li>)}
                </ul>
              )}
              {resultado.avisos?.length > 0 && (
                <ul className="text-xs text-amber-600 mt-2 space-y-0.5">
                  {resultado.avisos.map((a, i) => <li key={i}>{a.sku}: {a.motivo}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={nuevaFactura} className="btn-secondary">Cargar otra factura</button>
            {!resultado && (
              <button onClick={confirmar} disabled={confirmando} className="btn-primary">
                {confirmando ? <Loader2 size={15} className="animate-spin" /> : null} Realizar entrada al sistema
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
