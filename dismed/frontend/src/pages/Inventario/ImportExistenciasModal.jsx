import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { X, Upload, Loader2, AlertTriangle, CheckCircle, Download, Link2, Check } from 'lucide-react';
import api from '../../services/api';
import { descargarArchivo } from '../../services/descargas';
import ProductoPicker from '../../components/shared/ProductoPicker';

export default function ImportExistenciasModal({ onClose, onDone }) {
  const [parsing, setParsing] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [almacenId, setAlmacenId] = useState('');
  const [vinculos, setVinculos] = useState({}); // sku_interno (del archivo) -> producto elegido
  const [picker, setPicker] = useState(null);   // renglón sin catálogo que se está vinculando

  const { data: almacenes = [] } = useQuery({
    queryKey: ['almacenes'], queryFn: () => api.get('/almacenes').then((r) => r.data),
  });

  const onDrop = async (files) => {
    const file = files[0]; if (!file) return;
    setParsing(true); setResultado(null); setVinculos({});
    try {
      const form = new FormData(); form.append('archivo', file);
      const { data } = await api.post('/inventario/import-existencias', form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      });
      setResultado(data);
      toast.success(`${data.resumen.total} renglones leídos`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al leer el archivo');
    } finally { setParsing(false); }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, maxFiles: 1,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [],
      'application/vnd.ms-excel': [],
      'text/csv': [],
    },
  });

  async function descargarPlantilla() {
    try {
      await descargarArchivo('/inventario/import-existencias/plantilla', 'plantilla_existencias.xlsx');
    } catch {
      toast.error('No se pudo descargar la plantilla');
    }
  }

  // Resuelto = ya estaba en catálogo, o el usuario vinculó su SKU a un producto existente.
  function estaResuelto(x) {
    return (x._en_catalogo || !!vinculos[x.sku_interno]) && Number(x.cantidad) > 0;
  }

  async function confirmar() {
    if (!almacenId) return toast.error('Selecciona el almacén destino');
    const renglones = resultado.renglones
      .filter(estaResuelto)
      .map((r) => ({ ...r, producto_id: r._producto_id || vinculos[r.sku_interno]?.id || null }));
    if (!renglones.length) return toast.error('No hay renglones válidos');
    setConfirmando(true);
    try {
      const { data } = await api.post('/inventario/import-existencias/confirmar',
        { almacen_id: almacenId, renglones }, { timeout: 300000 });
      toast.success(`Importadas ${data.importados} existencias${data.omitidos ? `, ${data.omitidos} omitidas` : ''}`);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al importar');
    } finally { setConfirmando(false); }
  }

  const r = resultado?.resumen;
  const validos = resultado ? resultado.renglones.filter(estaResuelto).length : 0;
  const sinCatalogo = resultado ? resultado.renglones.filter((x) => !x._en_catalogo) : [];
  const sinCatalogoUnicos = useMemo(() => {
    const vistos = new Set();
    return sinCatalogo.filter((x) => {
      if (vistos.has(x.sku_interno)) return false;
      vistos.add(x.sku_interno);
      return true;
    });
  }, [sinCatalogo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-gray-900">Importar existencias</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="label">Almacén destino *</label>
            <select className="input w-72" value={almacenId} onChange={(e) => setAlmacenId(e.target.value)}>
              <option value="">— Selecciona —</option>
              {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">Las ubicaciones (TARIMA) se crean automáticamente en este almacén.</p>
          </div>

          <div className="flex justify-end">
            <button
              onClick={descargarPlantilla}
              className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline"
            >
              <Download size={15} /> Descargar plantilla de ejemplo
            </button>
          </div>

          <div {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
              ${isDragActive ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-300'}`}>
            <input {...getInputProps()} />
            {parsing ? (
              <div className="flex flex-col items-center gap-2 text-brand-500"><Loader2 size={32} className="animate-spin" /><p>Leyendo…</p></div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-400">
                <Upload size={32} /><p className="font-medium text-gray-600">Sube el archivo de existencias (.xlsx, .xls, .csv)</p>
              </div>
            )}
          </div>

          {r && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div className="bg-gray-50 rounded-lg px-3 py-2"><p className="text-xs text-gray-400">Renglones</p><p className="font-bold">{r.total}</p></div>
                <div className="bg-green-50 rounded-lg px-3 py-2"><p className="text-xs text-green-600">Válidos</p><p className="font-bold text-green-700">{validos}</p></div>
                <div className="bg-amber-50 rounded-lg px-3 py-2"><p className="text-xs text-amber-600">Sin catálogo</p><p className="font-bold text-amber-700">{r.sin_catalogo}</p></div>
                <div className="bg-gray-50 rounded-lg px-3 py-2"><p className="text-xs text-gray-400">Ubicaciones</p><p className="font-bold">{r.ubicaciones?.length}</p></div>
              </div>

              {sinCatalogoUnicos.length > 0 && (
                <div className="text-xs">
                  <div className="flex items-center gap-2 mb-1.5 text-amber-700">
                    <AlertTriangle size={14} />
                    <span>{sinCatalogoUnicos.length} SKU no están en el catálogo — vincúlalos a un producto existente o se omitirán:</span>
                  </div>
                  <ul className="space-y-1 max-h-48 overflow-y-auto border border-amber-100 rounded-lg p-2 bg-amber-50/50">
                    {sinCatalogoUnicos.map((x) => {
                      const v = vinculos[x.sku_interno];
                      return (
                        <li key={x.sku_interno} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">
                            <span className="font-mono text-gray-700">{x.sku_interno}</span>
                            {x.descripcion && <span className="text-gray-400"> — {x.descripcion.substring(0, 50)}</span>}
                          </span>
                          {v ? (
                            <span className="shrink-0 inline-flex items-center gap-1 text-green-700">
                              <Check size={13} /> <span className="font-mono">{v.sku_interno}</span>
                              <button onClick={() => setPicker(x)} className="text-brand-500 hover:underline ml-1">cambiar</button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setPicker(x)}
                              className="shrink-0 inline-flex items-center gap-1 text-brand-500 hover:underline"
                            >
                              <Link2 size={13} /> Vincular
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <p className="text-sm text-gray-600 flex items-center gap-1"><CheckCircle size={15} className="text-green-600" />Se cargarán <strong>{validos}</strong> existencias.</p>
                <div className="flex gap-2">
                  <button onClick={onClose} className="btn-secondary">Cancelar</button>
                  <button onClick={confirmar} disabled={confirmando || !validos || !almacenId} className="btn-primary">
                    {confirmando ? <Loader2 size={15} className="animate-spin" /> : null} Importar {validos}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {picker && (
        <ProductoPicker
          open={!!picker}
          onClose={() => setPicker(null)}
          incluirNoVendibles
          partida={{ descripcion_original: picker.descripcion, codigo_cliente: picker.sku_interno }}
          onSelect={(prod) => { setVinculos((v) => ({ ...v, [picker.sku_interno]: prod })); setPicker(null); }}
        />
      )}
    </div>
  );
}
