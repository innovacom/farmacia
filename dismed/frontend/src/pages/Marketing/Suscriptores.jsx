import { useQuery } from '@tanstack/react-query';
import { Mail, FileSpreadsheet } from 'lucide-react';
import api from '../../services/api';
import { exportarExcel, hoyISO } from '../../services/exportarExcel';

/**
 * Correos capturados por el formulario de boletín en /tienda
 * (BoletinForm.jsx → POST /tienda/suscriptores). Solo lectura — la baja de
 * un suscriptor no tiene UI todavía, se marcaría activo=0 directo en BD si
 * alguien lo pide por correo (mismo procedimiento que ya describe el aviso
 * de privacidad: legal@innovacom.mx / "BAJA").
 */
export default function Suscriptores() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['marketing-suscriptores'],
    queryFn: () => api.get('/marketing/suscriptores').then((r) => r.data),
  });

  const exportar = () => exportarExcel(
    `suscriptores_${hoyISO()}.xlsx`,
    'Suscriptores',
    data.map((s) => ({
      Correo: s.email,
      Nombre: s.nombre || '',
      'Fecha de suscripción': new Date(s.created_at).toLocaleDateString('es-MX'),
    }))
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Mail size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Suscriptores del boletín</h1>
        </div>
        <button className="btn-secondary" disabled={!data.length} onClick={exportar}>
          <FileSpreadsheet size={16} /> Exportar Excel
        </button>
      </div>

      <p className="text-sm text-gray-500 mb-4 max-w-2xl">
        Correos capturados desde el formulario "Recibe nuestras ofertas" en el pie del catálogo público /tienda.
      </p>

      {isLoading ? (
        <p className="text-gray-400">Cargando…</p>
      ) : !data.length ? (
        <div className="card text-center text-gray-500 py-10">
          Todavía no hay suscriptores.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-2 font-medium">Correo</th>
                <th className="pb-2 font-medium">Nombre</th>
                <th className="pb-2 font-medium">Suscrito</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-b border-gray-50">
                  <td className="py-2 text-gray-900">{s.email}</td>
                  <td className="py-2 text-gray-500">{s.nombre || '—'}</td>
                  <td className="py-2 text-gray-500">{new Date(s.created_at).toLocaleDateString('es-MX')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
