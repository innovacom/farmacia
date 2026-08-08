import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Megaphone, Send, Info } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';

const ESTATUS_BADGE = {
  enviando: 'badge-yellow',
  completada: 'badge-green',
  cancelada: 'badge-gray',
  borrador: 'badge-gray',
};

/**
 * Envío masivo (permiso whatsapp-masivos, solo admin): manda una plantilla YA
 * APROBADA por Meta a un grupo de contactos que aceptan promociones. Fuera
 * de la ventana de 24h desde su último mensaje, un negocio SOLO puede
 * escribirle a un contacto con una plantilla — por eso esto no es "texto
 * libre a varios", es la única forma real de mandar una promoción.
 */
export default function EnvioMasivo() {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [filtroEtiqueta, setFiltroEtiqueta] = useState('');
  const [personalizarNombre, setPersonalizarNombre] = useState(false);
  const [variableValor, setVariableValor] = useState('');
  const [detalleId, setDetalleId] = useState(null);

  const { data: plantillas = [], isLoading: cargandoPlantillas } = useQuery({
    queryKey: ['wa-plantillas'],
    queryFn: () => api.get('/whatsapp/campanas/plantillas').then((r) => r.data),
  });
  const { data: etiquetas = [] } = useQuery({
    queryKey: ['wa-etiquetas'],
    queryFn: () => api.get('/whatsapp/contactos/etiquetas').then((r) => r.data),
  });
  const { data: campanas = [] } = useQuery({
    queryKey: ['wa-campanas'],
    queryFn: () => api.get('/whatsapp/campanas').then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.some((c) => c.estatus === 'enviando') ? 3000 : false),
  });

  const template = plantillas.find((t) => `${t.name}|${t.language}` === templateKey);

  const crear = useMutation({
    mutationFn: () => api.post('/whatsapp/campanas', {
      nombre,
      template_name: template.name,
      template_lang: template.language,
      filtro_etiqueta: filtroEtiqueta || null,
      personalizar_nombre: template.variable ? personalizarNombre : false,
      variable_valor: template.variable && !personalizarNombre ? variableValor : null,
    }),
    onSuccess: (r) => {
      toast.success(`Campaña lanzada a ${r.data.total_destinatarios} contactos`);
      qc.invalidateQueries({ queryKey: ['wa-campanas'] });
      setNombre(''); setTemplateKey(''); setFiltroEtiqueta(''); setPersonalizarNombre(false); setVariableValor('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al lanzar la campaña'),
  });

  const puedeEnviar = nombre.trim() && template?.soportada
    && (!template.variable || personalizarNombre || variableValor.trim());

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Megaphone size={22} className="text-brand-500" />
        <h1 className="text-2xl font-bold text-gray-900">Envío masivo</h1>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Manda una promoción con una plantilla aprobada a tus contactos. Solo se envía a quien acepta promociones.
      </p>

      <div className="card mb-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Nombre de la campaña</label>
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Promoción de agosto" />
          </div>
          <div>
            <label className="label">Plantilla aprobada</label>
            <select className="input" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
              <option value="">— Elegir plantilla —</option>
              {plantillas.map((t) => (
                <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`} disabled={!t.soportada}>
                  {t.name} ({t.language}){!t.soportada ? ' — no soportada' : ''}
                </option>
              ))}
            </select>
            {cargandoPlantillas && <p className="text-xs text-gray-400 mt-1">Cargando plantillas de Meta…</p>}
            {!cargandoPlantillas && !plantillas.length && (
              <p className="text-xs text-amber-600 mt-1">No hay plantillas aprobadas todavía en WhatsApp Manager.</p>
            )}
            {template && !template.soportada && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><Info size={12} /> {template.motivo}</p>
            )}
          </div>
          <div>
            <label className="label">Segmento (etiqueta, opcional)</label>
            <select className="input" value={filtroEtiqueta} onChange={(e) => setFiltroEtiqueta(e.target.value)}>
              <option value="">Todos los que aceptan promociones</option>
              {etiquetas.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          {template?.soportada && template.variable && (
            <div>
              <label className="label">Variable "{template.variable}" de la plantilla</label>
              <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                <input type="checkbox" checked={personalizarNombre} onChange={(e) => setPersonalizarNombre(e.target.checked)} />
                Usar el nombre de cada contacto
              </label>
              {!personalizarNombre && (
                <input className="input" placeholder="Texto fijo para todos" value={variableValor} onChange={(e) => setVariableValor(e.target.value)} />
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end mt-4">
          <button className="btn-primary" disabled={!puedeEnviar || crear.isPending} onClick={() => crear.mutate()}>
            <Send size={15} /> Lanzar campaña
          </button>
        </div>
      </div>

      <h2 className="font-semibold text-gray-800 mb-2">Campañas enviadas</h2>
      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Plantilla</th>
              <th className="text-center">Destinatarios</th>
              <th className="text-center">Enviados</th>
              <th className="text-center">Fallidos</th>
              <th>Estatus</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {campanas.map((c) => (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td className="text-xs font-mono">{c.template_name}</td>
                <td className="text-center">{c.total_destinatarios}</td>
                <td className="text-center text-green-700">{c.enviados}</td>
                <td className="text-center text-red-600">{c.fallidos}</td>
                <td><span className={ESTATUS_BADGE[c.estatus]}>{c.estatus}</span></td>
                <td><button className="btn-secondary btn-sm" onClick={() => setDetalleId(c.id)}>Ver</button></td>
              </tr>
            ))}
            {!campanas.length && <tr><td colSpan={7} className="text-center text-gray-400 py-8">Sin campañas todavía.</td></tr>}
          </tbody>
        </table>
      </div>

      {detalleId && <ModalDetalleCampana id={detalleId} onClose={() => setDetalleId(null)} />}
    </div>
  );
}

function ModalDetalleCampana({ id, onClose }) {
  const { data } = useQuery({
    queryKey: ['wa-campana', id],
    queryFn: () => api.get(`/whatsapp/campanas/${id}`).then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.estatus === 'enviando' ? 3000 : false),
  });

  return (
    <Modal title={data?.nombre || 'Detalle de campaña'} onClose={onClose} size="lg">
      {!data ? <p className="text-gray-400">Cargando…</p> : (
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="table-auto w-full">
            <thead><tr><th>Contacto</th><th>Teléfono</th><th>Estatus</th><th>Error</th></tr></thead>
            <tbody>
              {data.destinatarios.map((d, i) => (
                <tr key={i}>
                  <td>{d.nombre || '—'}</td>
                  <td className="font-mono text-xs">{d.telefono_normalizado}</td>
                  <td>
                    <span className={d.estatus === 'enviado' ? 'badge-green' : d.estatus === 'fallo' ? 'badge-gray' : 'badge-yellow'}>
                      {d.estatus}
                    </span>
                  </td>
                  <td className="text-xs text-red-500">{d.error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
