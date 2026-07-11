import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from '../../../components/ui/Modal';
import api from '../../../services/api';

/**
 * Captura de receta para venta de controlados/antibióticos (COFEPRIS).
 * Autocompletado de médico por cédula o nombre (catálogo propio `medicos`);
 * si no existe, alta inline. El domicilio del paciente se exige cuando el
 * carrito trae fracciones II/III (libro de control).
 * No cobra: entrega los datos a VentaMostrador, que los manda con la venta
 * (el backend vuelve a validar — la UI no es la fuente de verdad).
 */
export default function ModalReceta({ controlados = [], onClose, onCapturada }) {
  const [qMedico, setQMedico] = useState('');
  const [medico, setMedico] = useState(null);       // médico elegido del catálogo
  const [altaMedico, setAltaMedico] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: '', cedula_profesional: '', especialidad: '' });
  const [form, setForm] = useState({
    folio_receta: '',
    paciente_nombre: '',
    paciente_domicilio: '',
    fecha_receta: new Date().toISOString().slice(0, 10),
    retenida: true,
    surtimiento: 1,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const exigeDomicilio = controlados.some((c) =>
    ['fraccion_ii', 'fraccion_iii'].includes(c.clasificacion));

  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(qMedico), 300);
    return () => clearTimeout(t);
  }, [qMedico]);

  const { data: medicos = [] } = useQuery({
    queryKey: ['pos-medicos', debounced],
    queryFn: () => api.get('/pos/medicos', { params: { q: debounced } }).then((r) => r.data),
    enabled: debounced.length >= 2 && !medico && !altaMedico,
  });

  const medicoValido = medico || (altaMedico && nuevo.nombre.trim() && nuevo.cedula_profesional.trim());
  const valido = medicoValido && form.paciente_nombre.trim()
    && (!exigeDomicilio || form.paciente_domicilio.trim());

  function capturar() {
    onCapturada({
      medico_id: medico?.id || undefined,
      medico_nuevo: !medico && altaMedico ? nuevo : undefined,
      folio_receta: form.folio_receta || undefined,
      paciente_nombre: form.paciente_nombre.trim(),
      paciente_domicilio: form.paciente_domicilio.trim() || undefined,
      fecha_receta: form.fecha_receta,
      retenida: form.retenida,
      surtimiento: Number(form.surtimiento) || 1,
    });
  }

  return (
    <Modal title="Receta médica requerida" onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3">
          <p className="text-sm text-yellow-800 font-medium">Productos que exigen receta:</p>
          <ul className="text-sm text-yellow-700 list-disc ml-5">
            {controlados.map((c) => <li key={c.producto_id}>{c.descripcion}</li>)}
          </ul>
        </div>

        {/* Médico */}
        <div>
          <label className="label">Médico (busca por cédula o nombre)</label>
          {medico ? (
            <div className="flex items-center gap-2 bg-green-50 rounded-lg px-3 py-2">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{medico.nombre}</p>
                <p className="text-xs text-gray-500 font-mono">Cédula: {medico.cedula_profesional}</p>
              </div>
              <button className="btn-secondary btn-sm" onClick={() => { setMedico(null); setQMedico(''); }}>
                Cambiar
              </button>
            </div>
          ) : altaMedico ? (
            <div className="grid grid-cols-2 gap-2 bg-gray-50 rounded-lg p-3">
              <input className="input" placeholder="Nombre completo" value={nuevo.nombre}
                onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} />
              <input className="input font-mono" placeholder="Cédula profesional" value={nuevo.cedula_profesional}
                onChange={(e) => setNuevo((n) => ({ ...n, cedula_profesional: e.target.value }))} />
              <input className="input" placeholder="Especialidad (opcional)" value={nuevo.especialidad}
                onChange={(e) => setNuevo((n) => ({ ...n, especialidad: e.target.value }))} />
              <button className="btn-secondary btn-sm justify-self-start self-center"
                onClick={() => setAltaMedico(false)}>
                Volver a buscar
              </button>
            </div>
          ) : (
            <div className="relative">
              <input className="input" value={qMedico} autoFocus
                placeholder="Ej. 1234567 o Dr. García"
                onChange={(e) => setQMedico(e.target.value)} />
              {debounced.length >= 2 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {medicos.map((m) => (
                    <button key={m.id}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50"
                      onClick={() => setMedico(m)}>
                      <p className="text-sm text-gray-900">{m.nombre}</p>
                      <p className="text-xs text-gray-400 font-mono">
                        {m.cedula_profesional}{m.especialidad ? ` · ${m.especialidad}` : ''}
                      </p>
                    </button>
                  ))}
                  <button
                    className="w-full text-left px-3 py-2 text-sm text-brand-500 hover:bg-brand-50 font-medium"
                    onClick={() => setAltaMedico(true)}>
                    + Registrar médico nuevo
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Receta / paciente */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Folio de la receta</label>
            <input className="input" value={form.folio_receta}
              onChange={(e) => set('folio_receta', e.target.value)} />
          </div>
          <div>
            <label className="label">Fecha de la receta</label>
            <input className="input" type="date" value={form.fecha_receta}
              onChange={(e) => set('fecha_receta', e.target.value)} />
          </div>
          <div>
            <label className="label">Paciente</label>
            <input className="input" value={form.paciente_nombre}
              onChange={(e) => set('paciente_nombre', e.target.value)} />
          </div>
          <div>
            <label className="label">
              Domicilio del paciente {exigeDomicilio ? '(obligatorio, fracción II/III)' : '(opcional)'}
            </label>
            <input className="input" value={form.paciente_domicilio}
              onChange={(e) => set('paciente_domicilio', e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="retenida" checked={form.retenida}
              onChange={(e) => set('retenida', e.target.checked)} />
            <label htmlFor="retenida" className="text-sm text-gray-700">Receta retenida en farmacia</label>
          </div>
          <div>
            <label className="label">Nº de surtimiento (fracción III: hasta 3)</label>
            <select className="input" value={form.surtimiento}
              onChange={(e) => set('surtimiento', e.target.value)}>
              <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valido} onClick={capturar}>
            Continuar al cobro
          </button>
        </div>
      </div>
    </Modal>
  );
}
