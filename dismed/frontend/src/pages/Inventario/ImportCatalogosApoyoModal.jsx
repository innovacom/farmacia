import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { Upload, Loader2, AlertTriangle, CheckCircle, Download } from 'lucide-react';
import api from '../../services/api';
import { descargarArchivo } from '../../services/descargas';
import Modal from '../../components/ui/Modal';

export default function ImportCatalogosApoyoModal({ onClose, onDone }) {
  const [parsing, setParsing] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState(null); // { taxonomia, unidades, resumen }

  const onDrop = async (files) => {
    const file = files[0]; if (!file) return;
    setParsing(true); setResultado(null);
    try {
      const form = new FormData(); form.append('archivo', file);
      const { data } = await api.post('/catalogos/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      });
      setResultado(data);
      toast.success(`${data.resumen.total_taxonomia} renglones de taxonomía y ${data.resumen.total_unidades} unidades leídas`);
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
      await descargarArchivo('/catalogos/import/plantilla', 'plantilla_catalogos_apoyo.xlsx');
    } catch {
      toast.error('No se pudo descargar la plantilla');
    }
  }

  async function confirmar() {
    if (!resultado) return;
    const taxonomia = resultado.taxonomia.filter((t) => t._ok);
    const unidades = resultado.unidades;
    if (!taxonomia.length && !unidades.length) return toast.error('No hay renglones válidos para importar');
    setConfirmando(true);
    try {
      const { data } = await api.post('/catalogos/import/confirmar',
        { taxonomia, unidades }, { timeout: 300000 });
      toast.success(`Importado: ${data.familias} familias, ${data.categorias} categorías, ${data.subcategorias} subcategorías, ${data.unidades} unidades`);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al importar');
    } finally { setConfirmando(false); }
  }

  const r = resultado?.resumen;
  const conError = resultado ? resultado.taxonomia.filter((t) => !t._ok) : [];
  const taxonomiaValida = resultado ? resultado.taxonomia.filter((t) => t._ok) : [];

  return (
    <Modal title="Importar catálogos de apoyo" onClose={onClose} size="xl">
      <div className="space-y-4">
          <p className="text-sm text-gray-500">
            La plantilla tiene dos hojas: <strong>TAXONOMIA</strong> (FAMILIA, CATEGORIA, SUBCATEGORIA —
            lo que venga en el mismo renglón queda relacionado) y <strong>UNIDADES</strong> (UNIDAD, FACTOR).
          </p>

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
                <Upload size={32} /><p className="font-medium text-gray-600">Sube el archivo de catálogos (.xlsx, .xls, .csv)</p>
              </div>
            )}
          </div>

          {r && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div className="bg-gray-50 rounded-lg px-3 py-2"><p className="text-xs text-gray-400">Familias</p><p className="font-bold">{r.familias}</p></div>
                <div className="bg-gray-50 rounded-lg px-3 py-2"><p className="text-xs text-gray-400">Categorías</p><p className="font-bold">{r.categorias}</p></div>
                <div className="bg-gray-50 rounded-lg px-3 py-2"><p className="text-xs text-gray-400">Subcategorías</p><p className="font-bold">{r.subcategorias}</p></div>
                <div className="bg-gray-50 rounded-lg px-3 py-2"><p className="text-xs text-gray-400">Unidades</p><p className="font-bold">{r.total_unidades}</p></div>
              </div>

              {conError.length > 0 && (
                <div className="text-xs text-amber-700">
                  <div className="flex items-center gap-2 mb-1"><AlertTriangle size={14} /><span>{conError.length} renglón(es) con error y se omitirán:</span></div>
                  <p className="text-gray-500">{conError.slice(0, 15).map((t) => `${t.familia} — ${t._error}`).join('; ')}{conError.length > 15 ? '…' : ''}</p>
                </div>
              )}

              {taxonomiaValida.length > 0 && (
                <div className="border border-gray-200 rounded-lg max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left">Familia</th>
                        <th className="px-2 py-1 text-left">Categoría</th>
                        <th className="px-2 py-1 text-left">Subcategoría</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxonomiaValida.map((t, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1">{t.familia}</td>
                          <td className="px-2 py-1 text-gray-500">{t.categoria || '—'}</td>
                          <td className="px-2 py-1 text-gray-500">{t.subcategoria || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {resultado.unidades.length > 0 && (
                <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left">Unidad</th>
                        <th className="px-2 py-1 text-right">Factor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.unidades.map((u, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1">{u.unidad}</td>
                          <td className="px-2 py-1 text-right text-gray-500">{u.factor ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <p className="text-sm text-gray-600 flex items-center gap-1">
                  <CheckCircle size={15} className="text-green-600" />
                  Se importarán <strong>{taxonomiaValida.length}</strong> renglones de taxonomía y <strong>{resultado.unidades.length}</strong> unidades.
                </p>
                <div className="flex gap-2">
                  <button onClick={onClose} className="btn-secondary">Cancelar</button>
                  <button onClick={confirmar} disabled={confirmando || (!taxonomiaValida.length && !resultado.unidades.length)} className="btn-primary">
                    {confirmando ? <Loader2 size={15} className="animate-spin" /> : null} Importar
                  </button>
                </div>
              </div>
            </>
          )}
      </div>
    </Modal>
  );
}
