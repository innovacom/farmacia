import { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  Upload, FileSpreadsheet, Download, Loader2, CheckCircle2, AlertTriangle,
  X, Check, ArrowRight,
} from 'lucide-react';
import api from '../../services/api';
import { descargarArchivo } from '../../services/descargas';

const TIPOS = [
  { value: 'catalogo',     label: 'Catálogo por proveedor',
    desc: 'Productos, precios y unidades de cada proveedor.' },
  { value: 'equivalencias', label: 'Equivalencias SKU',
    desc: 'Relación entre el SKU del proveedor y el código INNOVACOM.' },
];

export default function ImportarDatos() {
  const [tipo, setTipo] = useState('catalogo');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resultado, setResultado] = useState(null);
  const inputRef = useRef(null);

  function reset() {
    setFile(null); setPreview(null); setResultado(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function onPickTipo(v) {
    setTipo(v); reset();
  }

  async function onFile(f) {
    if (!f) return;
    setFile(f); setPreview(null); setResultado(null);
    setLoadingPrev(true);
    try {
      const fd = new FormData();
      fd.append('archivo', f);
      const r = await api.post(`/herramientas/importar/${tipo}?dry_run=1`, fd);
      setPreview(r.data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'No se pudo leer el archivo');
      reset();
    } finally {
      setLoadingPrev(false);
    }
  }

  async function importar() {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('archivo', file);
      const r = await api.post(`/herramientas/importar/${tipo}`, fd);
      setResultado(r.data.resultado);
      toast.success('Importación completada');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Error al importar');
    } finally {
      setImporting(false);
    }
  }

  async function descargarPlantilla() {
    try {
      await descargarArchivo(`/herramientas/plantilla/${tipo}`, `plantilla_${tipo}.xlsx`);
    } catch {
      toast.error('No se pudo descargar la plantilla');
    }
  }

  const faltantes = preview?.faltantes || [];
  const puedeImportar = preview && faltantes.length === 0 && !resultado;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-2">
        <Upload className="text-brand-500" size={22} />
        <h1 className="text-xl font-bold text-gray-900">Importar datos</h1>
      </div>

      {/* Tipo de archivo */}
      <div className="grid sm:grid-cols-2 gap-3">
        {TIPOS.map((t) => (
          <button
            key={t.value}
            onClick={() => onPickTipo(t.value)}
            className={`text-left border rounded-xl p-4 transition-colors
              ${tipo === t.value
                ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                : 'border-gray-200 bg-white hover:border-gray-300'}`}
          >
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={18} className={tipo === t.value ? 'text-brand-500' : 'text-gray-400'} />
              <span className="font-semibold text-gray-900">{t.label}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">{t.desc}</p>
          </button>
        ))}
      </div>

      {/* Carga de archivo */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-medium text-gray-700">Archivo a importar (.xlsx, .xls, .csv)</p>
          <button
            onClick={descargarPlantilla}
            className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline"
          >
            <Download size={15} /> Descargar plantilla de ejemplo
          </button>
        </div>

        <label
          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300
                     rounded-xl py-8 cursor-pointer hover:border-brand-400 hover:bg-gray-50 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <FileSpreadsheet size={28} className="text-gray-400" />
          {file ? (
            <span className="text-sm text-gray-700 font-medium">{file.name}</span>
          ) : (
            <span className="text-sm text-gray-500">Arrastra el archivo aquí o haz clic para seleccionarlo</span>
          )}
        </label>

        {loadingPrev && (
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <Loader2 className="animate-spin" size={15} /> Analizando archivo…
          </p>
        )}
      </div>

      {/* Vista previa de columnas */}
      {preview && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Columnas detectadas</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {preview.columnas.map((c) => (
              <div
                key={c.campo}
                className={`border rounded-lg p-3 ${
                  c.presente ? 'border-green-200 bg-green-50'
                  : c.requerido ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}
              >
                <div className="flex items-center gap-1.5">
                  {c.presente
                    ? <Check size={14} className="text-green-600 shrink-0" />
                    : c.requerido
                      ? <X size={14} className="text-red-500 shrink-0" />
                      : <X size={14} className="text-gray-400 shrink-0" />}
                  <span className="text-sm font-medium text-gray-800">{c.etiqueta}</span>
                  {c.requerido && <span className="text-[10px] text-red-500 font-semibold ml-auto">OBLIGATORIA</span>}
                </div>
                {c.presente ? (
                  <p className="text-xs text-gray-500 mt-1 truncate">
                    Columna: <span className="font-mono">{c.encabezado_detectado}</span>
                    {c.ejemplo != null && <> · ej. <span className="text-gray-700">{c.ejemplo}</span></>}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">No encontrada en el archivo</p>
                )}
              </div>
            ))}
          </div>

          {/* Estadísticas */}
          <div className="flex flex-wrap gap-2 text-xs">
            <Stat label="Renglones" value={preview.stats.totalFilas} />
            <Stat label="Proveedores distintos" value={preview.stats.proveedoresDistintos} />
            {preview.stats.proveedoresNuevos > 0 &&
              <Stat label="Proveedores nuevos (se crearán)" value={preview.stats.proveedoresNuevos} warn />}
            {preview.stats.conPrecio != null && <Stat label="Con precio" value={preview.stats.conPrecio} />}
            {preview.stats.clavesGeneradas > 0 && <Stat label="SKU generados automáticamente" value={preview.stats.clavesGeneradas} warn />}
          </div>

          {preview.stats.clavesGeneradas > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                {preview.stats.clavesGeneradas} renglón(es) no traen SKU del proveedor; se les asignará una
                clave automática <span className="font-mono">GEN-XXXXXXXX</span> derivada del contenido del
                renglón. Reimportar el mismo archivo los actualiza (no los duplica).
              </span>
            </div>
          )}

          {faltantes.length > 0 && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>Faltan columnas obligatorias: <strong>{faltantes.join(', ')}</strong>. Corrige el archivo y vuelve a cargarlo.</span>
            </div>
          )}

          {/* Muestra */}
          {preview.muestra?.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs text-gray-500 mb-1">Muestra (primeros {preview.muestra.length} renglones):</p>
              <table className="w-full text-xs border border-gray-100">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-500">
                    {preview.columnas.filter((c) => c.presente).map((c) => (
                      <th key={c.campo} className="px-2 py-1 font-medium whitespace-nowrap">{c.etiqueta}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.muestra.map((row, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      {preview.columnas.filter((c) => c.presente).map((c) => (
                        <td key={c.campo} className="px-2 py-1 whitespace-nowrap">{row[c.campo] ?? '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!resultado && (
            <div className="flex justify-end">
              <button
                onClick={importar}
                disabled={!puedeImportar || importing}
                className="inline-flex items-center gap-2 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium
                           hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />}
                Importar {preview.stats.totalFilas} renglones
              </button>
            </div>
          )}
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <div className="bg-white border border-green-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 size={18} />
            <h2 className="font-semibold">Importación completada</h2>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Stat label="Insertados" value={resultado.insertados} />
            <Stat label="Actualizados" value={resultado.actualizados} />
            {resultado.vinculados != null && <Stat label="Vinculados a producto" value={resultado.vinculados} />}
            {resultado.sugeridos != null && <Stat label="Sugeridos" value={resultado.sugeridos} />}
            {resultado.proveedoresNuevos > 0 && <Stat label="Proveedores creados" value={resultado.proveedoresNuevos} />}
            {resultado.omitidos > 0 && <Stat label="Omitidos" value={resultado.omitidos} warn />}
          </div>
          <button onClick={reset} className="text-sm text-brand-500 hover:underline">Importar otro archivo</button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, warn }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border
      ${warn ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
      <strong className="tabular-nums">{Number(value).toLocaleString('es-MX')}</strong> {label}
    </span>
  );
}
