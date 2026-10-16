import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, Plus, Search, Wallet } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import Modal from '../../components/ui/Modal';

const mxn = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fechaCorta = (d) => (d ? String(d).slice(0, 10) : '');
const hoyISO = () => new Date().toISOString().slice(0, 10);
const FORMAS = ['transferencia', 'cheque', 'efectivo', 'tarjeta', 'otro'];

export default function Cobranza() {
  const { clienteId } = useParams();
  return clienteId ? <DetalleCliente clienteId={clienteId} /> : <Resumen />;
}

// ── Lista de clientes con saldo ────────────────────────────────────────────────
function Resumen() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const esAdmin = useAuthStore((s) => s.user?.rol) === 'admin';
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['cobranza', 'resumen'],
    queryFn: () => api.get('/cobranza/resumen').then((r) => r.data),
  });

  const modoMut = useMutation({
    mutationFn: (credito_modo) => api.put('/cobranza/config', { credito_modo }),
    onSuccess: () => { toast.success('Modo de crédito actualizado'); qc.invalidateQueries(['cobranza', 'resumen']); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.clientes || []).filter((c) => !t || `${c.razon_social} ${c.rfc}`.toLowerCase().includes(t));
  }, [data, q]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Cobranza</h1>
        {esAdmin && data && (
          <label className="text-xs text-gray-600 flex items-center gap-2">
            Al rebasar el crédito en un pedido:
            <select className="input !w-auto !py-1" value={data.credito_modo}
              onChange={(e) => modoMut.mutate(e.target.value)}>
              <option value="aviso">Solo avisar</option>
              <option value="bloqueo">Bloquear (admin autoriza)</option>
            </select>
          </label>
        )}
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-4 mb-4 max-w-md">
          <div className="card"><p className="text-xs text-gray-500">Saldo por cobrar</p><p className="text-xl font-bold">{mxn(data.totales.saldo)}</p></div>
          <div className="card"><p className="text-xs text-gray-500">Vencido</p><p className="text-xl font-bold text-red-600">{mxn(data.totales.vencido)}</p></div>
        </div>
      )}

      <div className="relative mb-4 w-72">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input pl-9" placeholder="Buscar cliente o RFC…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card">
        {isLoading ? <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
          : filas.length === 0 ? <p className="text-sm text-gray-400 text-center py-10">Sin saldos pendientes</p>
          : (
            <table className="table-auto w-full">
              <thead><tr><th>Cliente</th><th>RFC</th><th className="text-center">Facturas</th>
                <th className="text-right">Saldo</th><th className="text-right">Vencido</th><th className="text-right">Límite</th></tr></thead>
              <tbody>
                {filas.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/cobranza/${c.id}`)}>
                    <td>
                      <Link to={`/cobranza/${c.id}`} className="font-medium text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>{c.razon_social}</Link>
                      {c.num_sucursales > 1 && <p className="text-xs text-gray-400">{c.num_sucursales} sucursales</p>}
                    </td>
                    <td className="font-mono text-xs">{c.rfc}</td>
                    <td className="text-center">{c.facturas}</td>
                    <td className="text-right font-medium">{mxn(c.saldo)}</td>
                    <td className={`text-right ${c.vencido > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{mxn(c.vencido)}</td>
                    <td className={`text-right text-xs ${c.excede ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                      {c.limite_credito > 0 ? mxn(c.limite_credito) : 'Sin límite'}{c.excede ? ' ⚠' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

// ── Detalle de un cliente ──────────────────────────────────────────────────────
function Barra({ saldo, limite }) {
  if (!limite || limite <= 0) return null;
  const pct = Math.min(100, Math.round((saldo / limite) * 100));
  return (
    <div className="h-1.5 bg-gray-100 rounded mt-1">
      <div className={`h-1.5 rounded ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function DetalleCliente({ clienteId }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCobro, setShowCobro] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['cobranza', 'cliente', clienteId],
    queryFn: () => api.get(`/cobranza/clientes/${clienteId}`).then((r) => r.data),
  });

  const cancelarMut = useMutation({
    mutationFn: (id) => api.post(`/cobranza/cobros/${id}/cancelar`),
    onSuccess: () => { toast.success('Cobro cancelado'); refrescar(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });
  function refrescar() {
    qc.invalidateQueries(['cobranza']);
  }

  if (isLoading) return <p className="text-gray-400 text-center py-10">Cargando…</p>;
  if (!data) return <p className="text-gray-400 text-center py-10">Cliente no encontrado</p>;
  const { cliente, consolidado: cons, sucursales, facturas, cobros } = data;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/cobranza')} className="text-gray-400 hover:text-gray-700"><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{cliente.razon_social}</h1>
          <p className="text-sm text-gray-500">{cliente.rfc} · {cliente.dias_credito || 0} días de crédito</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCobro(true)}><Plus size={16} /> Registrar cobro</button>
      </div>

      {/* Consolidado */}
      <div className="card grid grid-cols-2 md:grid-cols-5 gap-4">
        <div><p className="text-xs text-gray-500">Facturado</p><p className="font-bold">{mxn(cons.facturado)}</p></div>
        <div><p className="text-xs text-gray-500">Cobrado</p><p className="font-bold">{mxn(cons.cobrado)}</p></div>
        <div><p className="text-xs text-gray-500">Saldo</p><p className="font-bold">{mxn(cons.saldo)}</p></div>
        <div><p className="text-xs text-gray-500">Vencido</p><p className={`font-bold ${cons.vencido > 0 ? 'text-red-600' : ''}`}>{mxn(cons.vencido)}</p></div>
        <div>
          <p className="text-xs text-gray-500">Límite consolidado</p>
          <p className="font-bold">{cons.limite_credito > 0 ? mxn(cons.limite_credito) : 'Sin límite'}</p>
          <Barra saldo={cons.saldo} limite={cons.limite_credito} />
        </div>
        {cons.sin_aplicar > 0 && (
          <p className="col-span-full text-xs text-amber-700">Hay {mxn(cons.sin_aplicar)} en cobros sin aplicar a facturas.</p>
        )}
      </div>

      {/* Por sucursal */}
      {sucursales.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sucursales.map((s) => (
            <div key={s.id} className={`card ${!s.activo ? 'opacity-50' : ''}`}>
              <p className="font-medium">{s.nombre}</p>
              <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                <div><p className="text-xs text-gray-500">Saldo</p><p className="font-semibold">{mxn(s.saldo)}</p></div>
                <div><p className="text-xs text-gray-500">Vencido</p><p className={s.vencido > 0 ? 'font-semibold text-red-600' : ''}>{mxn(s.vencido)}</p></div>
                <div><p className="text-xs text-gray-500">Límite</p><p>{s.limite_credito > 0 ? mxn(s.limite_credito) : '—'}</p></div>
              </div>
              <Barra saldo={s.saldo} limite={s.limite_credito} />
            </div>
          ))}
        </div>
      )}

      {/* Facturas abiertas */}
      <div className="card">
        <h2 className="font-semibold mb-3">Facturas con saldo</h2>
        {facturas.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">Sin facturas pendientes</p> : (
          <table className="table-auto w-full">
            <thead><tr><th>Folio</th><th>Sucursal</th><th>Fecha</th><th>Vence</th>
              <th className="text-right">Total</th><th className="text-right">Cobrado</th><th className="text-right">Saldo</th></tr></thead>
            <tbody>
              {facturas.map((f) => (
                <tr key={f.id}>
                  <td className="font-mono text-xs">{f.folio}</td>
                  <td className="text-xs">{f.sucursal || '—'}</td>
                  <td className="text-xs">{fechaCorta(f.created_at)}</td>
                  <td className="text-xs">
                    {fechaCorta(f.vence)}
                    {f.dias_vencida > 0 && <span className="ml-2 text-red-600 font-medium">{f.dias_vencida} d vencida</span>}
                  </td>
                  <td className="text-right">{mxn(f.total)}</td>
                  <td className="text-right">{mxn(f.cobrado)}</td>
                  <td className="text-right font-medium">{mxn(f.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Cobros */}
      <div className="card">
        <h2 className="font-semibold mb-3">Últimos cobros</h2>
        {cobros.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">Sin cobros registrados</p> : (
          <table className="table-auto w-full">
            <thead><tr><th>Fecha</th><th>Sucursal</th><th>Forma</th><th>Referencia</th>
              <th className="text-right">Monto</th><th className="text-right">Aplicado</th><th /></tr></thead>
            <tbody>
              {cobros.map((c) => (
                <tr key={c.id} className={c.estatus === 'cancelado' ? 'opacity-40 line-through' : ''}>
                  <td className="text-xs">{fechaCorta(c.fecha)}</td>
                  <td className="text-xs">{c.sucursal || '—'}</td>
                  <td className="text-xs capitalize">{c.forma_pago}</td>
                  <td className="text-xs">{c.referencia}</td>
                  <td className="text-right">{mxn(c.monto)}</td>
                  <td className="text-right">{mxn(c.aplicado)}</td>
                  <td className="text-right">
                    {c.estatus === 'activo' && (
                      <button className="text-xs text-red-400 hover:underline"
                        onClick={() => window.confirm('¿Cancelar este cobro? Las facturas recuperarán su saldo.') && cancelarMut.mutate(c.id)}>
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCobro && (
        <CobroModal clienteId={clienteId} sucursales={sucursales} facturas={facturas}
          onClose={() => setShowCobro(false)} onSaved={() => { setShowCobro(false); refrescar(); }} />
      )}
    </div>
  );
}

// ── Registrar cobro, aplicando a facturas (las más antiguas primero) ───────────
function CobroModal({ clienteId, sucursales, facturas, onClose, onSaved }) {
  const [sucursalId, setSucursalId] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [monto, setMonto] = useState('');
  const [forma, setForma] = useState('transferencia');
  const [referencia, setReferencia] = useState('');
  const [aplic, setAplic] = useState({}); // entrega_id -> monto (texto)

  const visibles = facturas.filter((f) => !sucursalId || String(f.sucursal_id) === sucursalId);
  const aplicado = Object.values(aplic).reduce((s, v) => s + (parseFloat(String(v).replace(',', '.')) || 0), 0);
  const montoN = parseFloat(String(monto).replace(',', '.')) || 0;

  function autoAplicar() {
    let resto = montoN;
    const next = {};
    for (const f of visibles) {
      if (resto <= 0.005) break;
      const x = Math.min(resto, f.saldo);
      next[f.id] = x.toFixed(2);
      resto -= x;
    }
    setAplic(next);
  }

  const mut = useMutation({
    mutationFn: () => api.post('/cobranza/cobros', {
      cliente_id: Number(clienteId),
      sucursal_id: sucursalId ? Number(sucursalId) : null,
      fecha, monto: montoN, forma_pago: forma, referencia: referencia || null,
      aplicaciones: Object.entries(aplic)
        .map(([entrega_id, m]) => ({ entrega_id: Number(entrega_id), monto: parseFloat(String(m).replace(',', '.')) || 0 }))
        .filter((a) => a.monto > 0),
    }),
    onSuccess: (r) => {
      toast.success(r.data.sin_aplicar > 0 ? `Cobro registrado (${mxn(r.data.sin_aplicar)} sin aplicar)` : 'Cobro registrado');
      onSaved();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al registrar'),
  });

  const invalido = !(montoN > 0) || aplicado > montoN + 0.005;

  return (
    <Modal title="Registrar cobro" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {sucursales.length > 1 && (
            <div className="col-span-2">
              <label className="label">Sucursal (opcional)</label>
              <select className="input" value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setAplic({}); }}>
                <option value="">Todas / pago del corporativo</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}
          <div><label className="label">Fecha</label><input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div><label className="label">Monto (MXN)</label>
            <input className="input" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
          <div><label className="label">Forma de pago</label>
            <select className="input" value={forma} onChange={(e) => setForma(e.target.value)}>
              {FORMAS.map((f) => <option key={f} value={f} className="capitalize">{f}</option>)}
            </select></div>
          <div><label className="label">Referencia</label><input className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label !mb-0">Aplicar a facturas</label>
            <button type="button" className="text-xs text-brand-500 hover:underline" onClick={autoAplicar}>Aplicar a las más antiguas</button>
          </div>
          {visibles.length === 0 ? <p className="text-xs text-gray-400">Sin facturas con saldo.</p> : (
            <div className="max-h-56 overflow-y-auto border border-gray-100 rounded">
              <table className="table-auto w-full text-xs">
                <thead><tr><th>Folio</th><th>Sucursal</th><th className="text-right">Saldo</th><th className="text-right w-28">Aplicar</th></tr></thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr key={f.id}>
                      <td className="font-mono">{f.folio}</td><td>{f.sucursal || '—'}</td>
                      <td className="text-right">{mxn(f.saldo)}</td>
                      <td><input className="input !py-1 text-right" inputMode="decimal" value={aplic[f.id] ?? ''}
                        onChange={(e) => setAplic({ ...aplic, [f.id]: e.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={`text-xs mt-2 ${aplicado > montoN + 0.005 ? 'text-red-600' : 'text-gray-500'}`}>
            Aplicado {mxn(aplicado)} de {mxn(montoN)}{montoN > aplicado ? ` · ${mxn(montoN - aplicado)} quedarán sin aplicar` : ''}
          </p>
        </div>

        <div className="flex gap-3">
          <button className="btn-primary" disabled={invalido || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />} Registrar
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}
