import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Gauge, Settings2, AlertTriangle, ShoppingBag, MessageCircle, Wallet } from 'lucide-react';
import api from '../../services/api';

const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fpct = (n) => `${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const ESTATUS_PEDIDO = {
  pendiente: 'badge-yellow', preparando: 'badge-blue', listo: 'badge-green', en_reparto: 'badge-gray',
};

const PERIODOS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
];

/**
 * Panel de Supervisor — pedidos de WhatsApp pendientes de surtir, mensajes
 * sin responder, cierre de caja por sucursal y resumen contable, en una sola
 * pantalla. Admin-only (ver supervisor.routes.js). El job que manda la misma
 * información por WhatsApp cuando se rebasan los umbrales vive en
 * supervisor.cron.js — esta pantalla solo consulta y deja editar esos umbrales.
 */
export default function PanelSupervisor() {
  const qc = useQueryClient();
  const [sucursalId, setSucursalId] = useState('');
  const [periodo, setPeriodo] = useState('hoy');
  const [umbralesAbierto, setUmbralesAbierto] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['supervisor-panel', sucursalId, periodo],
    queryFn: () => api.get('/supervisor/panel', {
      params: { sucursal_id: sucursalId || undefined, periodo },
    }).then((r) => r.data),
    refetchInterval: 60000,
  });

  const { data: umbrales } = useQuery({
    queryKey: ['supervisor-umbrales'],
    queryFn: () => api.get('/supervisor/umbrales').then((r) => r.data),
    enabled: umbralesAbierto,
  });

  const pedidosAtrasados = data?.pedidos.filter((p) => p.atrasado).length || 0;
  const whatsappAtrasados = data?.whatsapp.filter((w) => w.atrasado).length || 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Gauge size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Panel de Supervisor</h1>
        </div>
        <div className="flex items-center gap-2">
          <select className="input" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
            <option value="">Todas las sucursales</option>
            {(data?.sucursales || []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <button className="btn-secondary flex items-center gap-2" onClick={() => setUmbralesAbierto((v) => !v)}>
            <Settings2 size={15} /> Umbrales
          </button>
        </div>
      </div>

      {isError && (
        <div className="card text-sm text-red-600 mb-4">
          No se pudo cargar el panel: {error?.response?.data?.error || error.message}
        </div>
      )}

      {!!data?.alertas?.length && (
        <div className="flex flex-wrap gap-2 mb-4">
          {data.alertas.map((a, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
                ${a.nivel === 'crit' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}
            >
              <AlertTriangle size={14} /> {a.mensaje}
            </div>
          ))}
        </div>
      )}

      {umbralesAbierto && umbrales && (
        <PanelUmbrales
          umbrales={umbrales}
          sucursales={data?.sucursales || []}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['supervisor-umbrales'] });
            qc.invalidateQueries({ queryKey: ['supervisor-panel'] });
          }}
        />
      )}

      {isLoading ? (
        <div className="card text-sm text-gray-400 text-center py-10">Cargando…</div>
      ) : data && (
        <>
          <div className="flex items-center gap-1 mb-2">
            {PERIODOS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriodo(p.key)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors
                  ${periodo === p.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            <Kpi label="Venta" valor={fmt(data.contable.venta)} />
            <Kpi label="Costo de venta" valor={fmt(data.contable.costo)} />
            <Kpi label="Ganancia" valor={fmt(data.contable.ganancia)} sub={fpct(data.contable.margen_pct)} tono="green" />
            <Kpi
              label="Pedidos por surtir"
              valor={data.pedidos.length}
              sub={pedidosAtrasados ? `${pedidosAtrasados} atrasado(s)` : null}
              tono={pedidosAtrasados ? 'red' : 'default'}
            />
            <Kpi
              label="WhatsApp sin responder"
              valor={data.whatsapp.length}
              sub={whatsappAtrasados ? `${whatsappAtrasados} urgente(s)` : null}
              tono={whatsappAtrasados ? 'red' : 'default'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="card p-0 overflow-x-auto">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                  <ShoppingBag size={16} /> Pedidos pendientes de surtir
                </h3>
                <Link to="/pos/pedidos-whatsapp" className="text-xs text-brand-500 hover:underline">Ver todos →</Link>
              </div>
              <table className="table-auto w-full">
                <thead>
                  <tr><th>Folio / cliente</th><th>Sucursal</th><th>Estatus</th><th className="text-right">Espera</th></tr>
                </thead>
                <tbody>
                  {data.pedidos.map((p) => (
                    <tr key={p.id} className={p.atrasado ? 'bg-red-50' : ''}>
                      <td>
                        <div className="font-mono text-xs font-medium">{p.folio}</div>
                        <div className="text-xs text-gray-500">{p.cliente}</div>
                      </td>
                      <td>{p.sucursal}</td>
                      <td><span className={`badge ${ESTATUS_PEDIDO[p.estatus] || 'badge-gray'}`}>{p.estatus}</span></td>
                      <td className={`text-right font-medium ${p.atrasado ? 'text-red-600' : 'text-gray-500'}`}>
                        {p.minutos_espera} min
                      </td>
                    </tr>
                  ))}
                  {!data.pedidos.length && (
                    <tr><td colSpan={4} className="text-center text-gray-400 py-8">Sin pedidos pendientes</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-4">
              <div className="card p-0">
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <MessageCircle size={16} /> WhatsApp sin responder
                  </h3>
                  <Link to="/whatsapp/bandeja" className="text-xs text-brand-500 hover:underline">Abrir bandeja →</Link>
                </div>
                <div className="divide-y divide-gray-100">
                  {data.whatsapp.map((w) => (
                    <div key={w.contacto_id} className="flex items-center justify-between px-4 py-2.5 gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{w.nombre || w.telefono}</div>
                        <div className="text-xs text-gray-500 truncate">{w.ultimo_mensaje}</div>
                      </div>
                      <div className={`text-xs font-medium whitespace-nowrap ${w.atrasado ? 'text-red-600' : 'text-gray-400'}`}>
                        hace {w.minutos_espera} min
                      </div>
                    </div>
                  ))}
                  {!data.whatsapp.length && <p className="text-center text-gray-400 py-8 text-sm">Todo respondido</p>}
                </div>
              </div>

              <div className="card p-0">
                <div className="px-4 pt-4 pb-2">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <Wallet size={16} /> Cierre de caja por sucursal
                  </h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {data.cajas.map((c) => (
                    <div key={c.turno_id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800">{c.sucursal}</span>
                        <span className={`badge ${c.estatus === 'abierto' ? 'badge-blue' : c.alerta_diferencia ? 'badge-red' : 'badge-green'}`}>
                          {c.estatus === 'abierto' ? 'Turno abierto' : c.alerta_diferencia ? 'Cerrado con diferencia' : 'Cerrado sin diferencia'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">Cajero: {c.cajero}</div>
                      {c.estatus === 'cerrado' && (
                        <div className="flex gap-4 text-xs mt-1.5">
                          <span>Esperado<b className="block text-gray-700">{fmt(c.efectivo_esperado)}</b></span>
                          <span>Contado<b className="block text-gray-700">{fmt(c.efectivo_contado)}</b></span>
                          <span className={c.alerta_diferencia ? 'text-red-600' : ''}>
                            Diferencia<b className="block">{fmt(c.diferencia)}</b>
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                  {!data.cajas.length && <p className="text-center text-gray-400 py-8 text-sm">Sin turnos hoy</p>}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, valor, sub, tono = 'default' }) {
  const tonos = { default: 'text-gray-900', green: 'text-green-700', red: 'text-red-700' };
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${tonos[tono] || tonos.default}`}>{valor}</div>
      {sub && <div className={`text-xs mt-1 ${tono === 'red' ? 'text-red-600' : 'text-gray-400'}`}>{sub}</div>}
    </div>
  );
}

// Umbral global (todas las sucursales) + override opcional por sucursal
// (solo para las claves marcadas porSucursal: true). Vacío en la celda de
// una sucursal = hereda el global (mismo criterio que backend/supervisor.umbrales.service.js).
const CAMPOS_UMBRAL = [
  { clave: 'pedido_sin_surtir_min', label: 'Pedido sin surtir', unidad: 'minutos', porSucursal: true },
  { clave: 'whatsapp_sin_responder_min', label: 'WhatsApp sin responder', unidad: 'minutos', porSucursal: false },
  { clave: 'diferencia_caja_pesos', label: 'Diferencia de caja al cierre', unidad: 'pesos', porSucursal: true },
  { clave: 'alertas_hora_inicio', label: 'Alertas desde', unidad: 'hora (0-23)', porSucursal: false },
  { clave: 'alertas_hora_fin', label: 'Alertas hasta', unidad: 'hora (0-23)', porSucursal: false },
];

function PanelUmbrales({ umbrales, sucursales, onSaved }) {
  const [global, setGlobal] = useState(umbrales.global);
  const [porSucursal, setPorSucursal] = useState(umbrales.porSucursal || {});
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setGlobal(umbrales.global);
    setPorSucursal(umbrales.porSucursal || {});
  }, [umbrales]);

  const setOverride = (sucursalId, clave, valor) => {
    setPorSucursal((prev) => ({ ...prev, [sucursalId]: { ...prev[sucursalId], [clave]: valor === '' ? null : valor } }));
  };

  const guardar = async () => {
    setSaving(true);
    setErrorMsg('');
    try {
      await api.put('/supervisor/umbrales', { global, porSucursal });
      onSaved();
    } catch (err) {
      setErrorMsg(err?.response?.data?.error || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card mb-4">
      <div className="mb-1 font-semibold text-gray-800">Umbrales de alerta</div>
      <p className="text-xs text-gray-500 mb-4">
        Solo admin los edita. El valor <b>Global</b> aplica a todas las sucursales salvo que una lo sobrescriba — vacío = usa el global.
      </p>

      <div className="overflow-x-auto">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>Umbral</th>
              <th className="text-right">Global</th>
              {sucursales.map((s) => <th key={s.id} className="text-right">{s.nombre}</th>)}
            </tr>
          </thead>
          <tbody>
            {CAMPOS_UMBRAL.map((c) => (
              <tr key={c.clave}>
                <td>{c.label}<div className="text-xs text-gray-400">{c.unidad}</div></td>
                <td className="text-right">
                  <input
                    type="number"
                    className="input w-24 text-right"
                    value={global[c.clave] ?? ''}
                    onChange={(e) => setGlobal((g) => ({ ...g, [c.clave]: e.target.value }))}
                  />
                </td>
                {sucursales.map((s) => (
                  <td key={s.id} className="text-right">
                    {c.porSucursal ? (
                      <input
                        type="number"
                        className="input w-24 text-right"
                        placeholder="global"
                        value={porSucursal[s.id]?.[c.clave] ?? ''}
                        onChange={(e) => setOverride(s.id, c.clave, e.target.value)}
                      />
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
        {errorMsg ? <span className="text-xs text-red-600">{errorMsg}</span> : <span />}
        <button className="btn-primary" onClick={guardar} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}
