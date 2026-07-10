import { useState, useRef, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Diálogo de confirmación del sistema (reemplaza window.confirm).
 *
 * Uso con el hook:
 *   const { confirmar, dialogoConfirm } = useConfirm();
 *   ...
 *   if (!(await confirmar('¿Eliminar este registro?'))) return;
 *   ...
 *   return (<div> ... {dialogoConfirm} </div>);
 *
 * Opciones: confirmar(mensaje, { titulo, textoConfirmar, danger })
 */
export default function ConfirmDialog({
  titulo = 'Confirmar acción',
  mensaje,
  textoConfirmar = 'Confirmar',
  danger = true,
  onResult,
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3">
            <div className={`shrink-0 rounded-full p-2 ${danger ? 'bg-red-50 text-red-500' : 'bg-brand-50 text-brand-500'}`}>
              <AlertTriangle size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900">{titulo}</h2>
              <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{mensaje}</p>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-5">
            <button type="button" onClick={() => onResult(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="button" autoFocus onClick={() => onResult(true)}
              className={danger ? 'btn-danger' : 'btn-primary'}>
              {textoConfirmar}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [opts, setOpts] = useState(null);
  const resolver = useRef(null);

  const confirmar = useCallback((mensaje, extra = {}) =>
    new Promise((resolve) => {
      resolver.current = resolve;
      setOpts({ mensaje, ...extra });
    }), []);

  function onResult(ok) {
    setOpts(null);
    resolver.current?.(ok);
    resolver.current = null;
  }

  const dialogoConfirm = opts ? <ConfirmDialog {...opts} onResult={onResult} /> : null;
  return { confirmar, dialogoConfirm };
}
