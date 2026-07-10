import { HelpCircle, Printer, ChevronRight } from 'lucide-react';
import manual from './manual.json';

// Menú de Ayuda: muestra el manual de usuario (fuente única en manual.json).
// El botón Imprimir usa las reglas @media print del index.css (oculta sidebar/controles).
export default function Ayuda() {
  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <HelpCircle size={22} className="text-brand-500" /> {manual.titulo}
          </h1>
          <p className="text-sm text-gray-500">{manual.subtitulo}</p>
        </div>
        <button onClick={() => window.print()} className="btn-secondary no-print">
          <Printer size={15} /> Imprimir / Guardar PDF
        </button>
      </div>

      {manual.intro && (
        <div className="card bg-brand-50 border-brand-100">
          <p className="text-sm text-gray-700">{manual.intro}</p>
        </div>
      )}

      {/* Índice */}
      <div className="card no-print">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Contenido</p>
        <div className="grid sm:grid-cols-2 gap-1">
          {manual.secciones.map((s) => (
            <a key={s.id} href={`#${s.id}`}
               className="flex items-center gap-1 text-sm text-gray-600 hover:text-brand-500 py-0.5">
              <ChevronRight size={14} /> {s.titulo}
            </a>
          ))}
        </div>
      </div>

      {/* Secciones */}
      {manual.secciones.map((s) => (
        <section key={s.id} id={s.id} className="card scroll-mt-20">
          <h2 className="font-semibold text-gray-800 text-lg mb-1">{s.titulo}</h2>
          {s.intro && <p className="text-sm text-gray-600 mb-3">{s.intro}</p>}
          {s.imagen && (
            <img
              src={s.imagen}
              alt={`Pantalla: ${s.titulo}`}
              loading="lazy"
              className="w-full rounded-lg border border-gray-200 shadow-sm mb-3"
            />
          )}
          {s.pasos?.length > 0 && (
            <ol className="list-decimal list-inside space-y-1.5 text-sm text-gray-700 mb-2">
              {s.pasos.map((p, i) => <li key={i}>{p}</li>)}
            </ol>
          )}
          {s.tips?.length > 0 && (
            <div className="mt-2 space-y-1">
              {s.tips.map((t, i) => (
                <p key={i} className="text-xs text-gray-500 flex gap-1.5">
                  <span className="text-brand-500 font-bold">Tip:</span> {t}
                </p>
              ))}
            </div>
          )}
        </section>
      ))}

      <p className="text-xs text-gray-400 text-center pt-2">
        {manual.subtitulo} · Manual de usuario
      </p>
    </div>
  );
}
