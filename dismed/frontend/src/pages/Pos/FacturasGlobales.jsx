import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, Stamp, Unlock as Liberar, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const ayer = () => {
  const d = new Date(Date.now() - 86400000);
  return d.toISOString().slice(0, 10);
};

/**
 * Factura global al público en general (XAXX010101000) — permiso pos-admin.
 * Dos pasos: crear borrador (marca los tickets sin factura del periodo y
 * muestra totales) → revisar → timbrar. Nada se timbra sin confirmación.
 * Una global fallida queda re-timbrable; "liberar" sus tickets es acción
 * manual explícita.
 */
export default function FacturasGlobales() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const [form, setForm] = useState({ periodicidad: '01', desde: ayer(), hasta: ayer(), sucursal_id: '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const { data: globales = [] } = useQuery({
    queryKey: ['pos-globales'],
    queryFn: () => api.get('/pos/facturas-globales').then((r) => r.data),
  });
  const { data: sucursales = [] } = useQuery({
    queryKey: ['pos-sucursales'],
    queryFn: () => api.get('/pos/sucursales').then((r) => r.data),
  });

  const refrescar = () => qc.invalidateQueries({ queryKey: ['pos-globales'] });

  const crear = useMutation({
    mutationFn: () => api.post('/pos/facturas-globales', {
      ...form, sucursal_id: form.sucursal_id || undefined,
    }),
    onSuccess: ({ data }) => {
      toast.success(`Borrador creado: ${data.num_tickets} tickets por ${money(data.total)}. Revísalo y tímbralo.`);
      refrescar();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al crear el borrador'),
  });

  const timbrar = useMutation({
    mutationFn: (id) => api.post(`/pos/facturas-globales/${id}/timbrar`),
    onSuccess: () => { toast.success('Factura global timbrada'); refrescar(); },
    onError: (e) => { toast.error(e.response?.data?.error || 'Error al timbrar'); refrescar(); },
  });

  const liberar = useMutation({
    mutationFn: (id) => api.post(`/pos/facturas-globales/${id}/liberar`),
    onSuccess: () => { toast.success('Tickets liberados'); refrescar(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al liberar'),
  });

  async function onTimbrar(g) {
    if (!(await confirmar(
      `Se timbrará la factura global de ${g.num_tickets} tickets por ${money(g.total)} al RFC XAXX010101000.`,
      { titulo: 'Timbrar factura global', textoConfirmar: 'Timbrar', danger: false }
    ))) return;
    timbrar.mutate(g.id);
  }

  async function onLiberar(g) {
    if (!(await confirmar(
      'Los tickets de esta global volverán a estar disponibles para otra factura. La global quedará cancelada.',
      { titulo: 'Liberar tickets' }
    ))) return;
    liberar.mutate(g.id);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Receipt size={22} className="text-brand-500" />
        <h1 className="text-2xl font-bold text-gray-900">Facturas globales (público en general)</h1>
      </div>

      <div className="card mb-5">
        <h2 className="font-semibold text-gray-900 mb-3">Nuevo periodo por facturar</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Periodicidad</label>
            <select className="input" value={form.periodicidad} onChange={(e) => set('periodicidad', e.target.value)}>
              <option value="01">Diaria (01)</option>
              <option value="02">Semanal (02)</option>
              <option value="03">Quincenal (03)</option>
              <option value="04">Mensual (04)</option>
            </select>
          </div>
          <div>
            <label className="label">Desde</label>
            <input type="date" className="input" value={form.desde} onChange={(e) => set('desde', e.target.value)} />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input type="date" className="input" value={form.hasta} onChange={(e) => set('hasta', e.target.value)} />
          </div>
          <div>
            <label className="label">Sucursal</label>
            <select className="input" value={form.sucursal_id} onChange={(e) => set('sucursal_id', e.target.value)}>
              <option value="">Todas</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <button className="btn-primary" disabled={crear.isPending} onClick={() => crear.mutate()}>
            Crear borrador
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          El borrador marca los tickets completados sin factura del periodo. Nada se timbra hasta que lo confirmes.
        </p>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>#</th><th>Periodo</th><th>Periodicidad</th><th>Sucursal</th>
              <th className="text-right">Tickets</th><th className="text-right">Total</th>
              <th>Estatus</th><th>UUID</th><th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {globales.map((g) => (
              <tr key={g.id}>
                <td>{g.id}</td>
                <td className="text-xs whitespace-nowrap">
                  {String(g.desde).slice(0, 10)} → {String(g.hasta).slice(0, 10)}
                </td>
                <td>{{ '01': 'Diaria', '02': 'Semanal', '03': 'Quincenal', '04': 'Mensual' }[g.periodicidad]}</td>
                <td>{g.sucursal || 'Todas'}</td>
                <td className="text-right">{g.num_tickets}</td>
                <td className="text-right font-semibold">{money(g.total)}</td>
                <td>
                  {g.estatus === 'timbrada' && <span className="badge-green">Timbrada</span>}
                  {g.estatus === 'borrador' && <span className="badge-yellow">Borrador</span>}
                  {g.estatus === 'cancelada' && <span className="badge-gray">Cancelada</span>}
                  {g.estatus === 'error' && (
                    <span className="badge-red" title={g.error_msg}>Error</span>
                  )}
                </td>
                <td className="font-mono text-xs">{g.uuid ? `${g.uuid.slice(0, 8)}…` : '—'}</td>
                <td className="text-right whitespace-nowrap">
                  {['borrador', 'error'].includes(g.estatus) && (
                    <>
                      <button className="btn-primary btn-sm" onClick={() => onTimbrar(g)}
                        disabled={timbrar.isPending}>
                        <Stamp size={13} /> Timbrar
                      </button>{' '}
                      <button className="btn-secondary btn-sm" onClick={() => onLiberar(g)}
                        disabled={liberar.isPending}>
                        <Liberar size={13} /> Liberar
                      </button>
                    </>
                  )}
                  {g.estatus === 'timbrada' && g.xml_path && (
                    <button className="btn-secondary btn-sm" onClick={() => window.open(g.xml_path, '_blank')}>
                      <ExternalLink size={13} /> XML
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!globales.length && (
              <tr><td colSpan={9} className="text-center text-gray-400 py-8">Sin facturas globales</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {dialogoConfirm}
    </div>
  );
}
