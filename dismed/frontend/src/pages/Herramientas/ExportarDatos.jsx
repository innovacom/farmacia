import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import api from '../../services/api';
import { descargarArchivo } from '../../services/descargas';

const TIPOS = [
  { value: 'catalogo',     label: 'Catálogo por proveedor',
    desc: 'Productos, precios y unidades en el mismo layout de importación.' },
  { value: 'equivalencias', label: 'Equivalencias SKU',
    desc: 'Relación SKU proveedor ↔ INNOVACOM (solo renglones equivalenciados).' },
];

export default function ExportarDatos() {
  const [tipo, setTipo] = useState('catalogo');
  const [provId, setProvId] = useState(''); // '' = todos
  const [bajando, setBajando] = useState(false);

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get('/proveedores').then((r) => r.data),
  });

  async function exportar() {
    setBajando(true);
    try {
      const nombre = `${tipo}_${provId ? `prov${provId}` : 'todos'}.xlsx`;
      await descargarArchivo(`/herramientas/exportar/${tipo}`, nombre,
        provId ? { proveedor_id: provId } : undefined);
      toast.success('Archivo generado');
    } catch (e) {
      toast.error(e.response?.data?.error || 'No se pudo exportar');
    } finally {
      setBajando(false);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-2">
        <Download className="text-brand-500" size={22} />
        <h1 className="text-xl font-bold text-gray-900">Exportar datos</h1>
      </div>

      {/* Tipo de archivo */}
      <div className="grid sm:grid-cols-2 gap-3">
        {TIPOS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTipo(t.value)}
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

      {/* Parámetros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor</label>
          <select
            value={provId}
            onChange={(e) => setProvId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full sm:w-80"
          >
            <option value="">Todos los proveedores</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_empresa}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            El archivo se genera con el mismo layout que se usa para importar, listo para reimportar.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            onClick={exportar}
            disabled={bajando}
            className="inline-flex items-center gap-2 bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium
                       hover:bg-brand-600 disabled:opacity-50"
          >
            {bajando ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
            Generar y descargar Excel
          </button>
        </div>
      </div>
    </div>
  );
}
