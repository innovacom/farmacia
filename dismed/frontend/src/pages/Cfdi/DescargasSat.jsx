import { Download } from 'lucide-react';

/**
 * STUB — El archivo original de esta página no está en el repositorio
 * (App.jsx la importaba pero pages/Cfdi/ no se versionó; el build fallaba).
 * Restaurar desde la copia de producción/OneDrive y reemplazar este stub.
 */
export default function DescargasSat() {
  return (
    <div className="card max-w-xl">
      <div className="flex items-center gap-2 mb-2">
        <Download size={20} className="text-brand-500" />
        <h1 className="text-xl font-bold text-gray-900">Descargas SAT</h1>
      </div>
      <p className="text-sm text-gray-500">
        Esta pantalla no está incluida en esta copia del código (el archivo
        original no se versionó). Restaurar <code>pages/Cfdi/DescargasSat.jsx</code>{' '}
        desde la copia de producción.
      </p>
    </div>
  );
}
