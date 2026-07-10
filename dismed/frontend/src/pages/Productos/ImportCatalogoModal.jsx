import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { X, Upload, Loader2, AlertTriangle, CheckCircle, Download } from 'lucide-react';
import api from '../../services/api';
import { descargarArchivo } from '../../services/descargas';

export default function ImportCatalogoModal({ onClose, onDone }) {
  const [parsing, setParsing] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState(null);   // { productos, resumen }
  const [incluir, setIncluir] = useState({});         // idx → bool (solo para filas con incidencia)

  const onDrop = async (files) => {
    const file = files[0];
    if (!file) return;
    setParsing(true); setResultado(null);
    try {
      const form = new FormData();
      form.append('archivo', file);
      const { data } = await api.post('/productos/import-catalogo', form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      });
      // Marca índice y estado por defecto de inclusión para filas con incidencia
      const inc = {};
      data.productos.forEach((p, i) => {
        p._idx = i;
        if (!p._ok) inc[i] = false; // duplicados/errores: excluidos por defecto, el usuario decide
      });
      setIncluir(inc);
      setResultado(data);
      toast.success(`${data.resumen.total} filas leídas`);
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
      await descargarArchivo('/productos/import-catalogo/plantilla', 'plantilla_catalogo_maestro.xlsx');
    } catch {
      toast.error('No se pudo descargar la plantilla');
    }
  }

  // Filas con incidencia (duplicado dentro del archivo o errores)
  const conIncidencia = (resultado?.productos || []).filter((p) => !p._ok);

  async function confirmar() {
    if (!resultado) return;
    // Importa: todas las OK + las incidencias que el usuario marcó para incluir
    const aImportar = resultado.productos.filter((p) => p._ok || incluir[p._idx]);
    if (!aImportar.length) return toast.error('No hay productos para importar');
    setConfirmando(true);
    try {
      const { data } = await api.post('/productos/import-catalogo/confirmar',
        { productos: aImportar }, { timeout: 300000 });
      toast.success(`Importados: ${data.insertados} nuevos, ${data.actualizados} actualizados${data.omitidos ? `, ${data.omitidos} omitidos` : ''}`);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al importar');
    } finally { setConfirmando(false); }
  }

  const r = resultado?.resumen;
  const totalImportar = resultado
    ? resultado.productos.filter((p) => p._ok || incluir[p._idx]).length : 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-gray-900">Importar catálogo maestro</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex justify-end">
            <button
              onClick={descargarPlantilla}
              className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline"
            >
              <Download size={15} /> Descargar plantilla de ejemplo
            </button>
          </div>

          {/* Zona de carga */}
          <div {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
              ${isDragActive ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-300'}`}>
            <input {...getInputProps()} />
            {parsing ? (
              <div className="flex flex-col items-center gap-2 text-brand-500">
                <Loader2 size={32} className="animate-spin" /><p>Leyendo archivo…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-400">
                <Upload size={32} />
                <p className="font-medium text-gray-600">Arrastra o haz clic para subir el catálogo (.xlsx, .xls, .csv)</p>
                <p className="text-xs">Se lee la hoja «CATALOGO»</p>
              </div>
            )}
          </div>

          {/* Resumen */}
          {r && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div className="bg-gray-50 rounded-lg px-3 py-2"><p className="text-xs text-gray-400">Total filas</p><p className="font-bold">{r.total}</p></div>
                <div className="bg-green-50 rounded-lg px-3 py-2"><p className="text-xs text-green-600">Válidas</p><p className="font-bold text-green-700">{r.ok}</p></div>
                <div className="bg-amber-50 rounded-lg px-3 py-2"><p className="text-xs text-amber-600">Duplicadas</p><p className="font-bold text-amber-700">{r.duplicados}</p></div>
                <div className="bg-red-50 rounded-lg px-3 py-2"><p className="text-xs text-red-600">Con errores</p><p className="font-bold text-red-700">{r.con_errores}</p></div>
              </div>
              {r.ya_en_bd > 0 && (
                <p className="text-xs text-gray-500">{r.ya_en_bd} productos ya existen en el sistema y se <strong>actualizarán</strong>.</p>
              )}

              {/* Tabla de incidencias para decidir */}
              {conIncidencia.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-sm text-amber-700 mb-2">
                    <AlertTriangle size={15} />
                    <span>Revisa estas {conIncidencia.length} filas con incidencia. Marca las que quieras importar de todas formas.</span>
                  </div>
                  <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 w-8"></th>
                          <th className="px-2 py-1 text-left">SKU</th>
                          <th className="px-2 py-1 text-left">Descripción</th>
                          <th className="px-2 py-1 text-left">Incidencia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conIncidencia.map((p) => (
                          <tr key={p._idx} className="border-t border-gray-100">
                            <td className="px-2 py-1 text-center">
                              <input type="checkbox" className="h-4 w-4 accent-brand-500"
                                checked={!!incluir[p._idx]}
                                onChange={(e) => setIncluir((s) => ({ ...s, [p._idx]: e.target.checked }))} />
                            </td>
                            <td className="px-2 py-1 font-mono text-brand-500">{p.sku_interno || '—'}</td>
                            <td className="px-2 py-1 max-w-[220px] truncate">{p.descripcion}</td>
                            <td className="px-2 py-1 text-red-500">
                              {p._duplicado ? 'SKU duplicado en archivo. ' : ''}{(p._errores || []).join(', ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <p className="text-sm text-gray-600 flex items-center gap-1">
                  <CheckCircle size={15} className="text-green-600" />
                  Se importarán <strong>{totalImportar}</strong> productos.
                </p>
                <div className="flex gap-2">
                  <button onClick={onClose} className="btn-secondary">Cancelar</button>
                  <button onClick={confirmar} disabled={confirmando || totalImportar === 0} className="btn-primary">
                    {confirmando ? <Loader2 size={15} className="animate-spin" /> : null}
                    Importar {totalImportar}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
