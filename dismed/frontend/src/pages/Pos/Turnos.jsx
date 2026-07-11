import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, PlusCircle, MinusCircle, Lock, Unlock } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/**
 * Caja y turnos (permiso pos-turnos): apertura con fondo, retiros/depósitos,
 * corte y cierre con arqueo. La diferencia (contado - esperado) se registra
 * y se muestra; el sistema nunca la ajusta.
 */
export default function Turnos() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const [cajaId, setCajaId] = useState(() => localStorage.getItem('pos-caja') || '');
  const [modalMov, setModalMov] = useState(null);   // null | 'retiro' | 'deposito'
  const [modalCierre, setModalCierre] = useState(false);

  useEffect(() => {
    if (cajaId) localStorage.setItem('pos-caja', cajaId);
  }, [cajaId]);

  const { data: cajas = [] } = useQuery({
    queryKey: ['pos-cajas'],
    queryFn: () => api.get('/pos/cajas').then((r) => r.data),
  });

  const { data: turno, isFetching: cargandoTurno } = useQuery({
    queryKey: ['pos-turno-actual', cajaId],
    queryFn: () =>
      api.get('/pos/turnos/actual', { params: { caja_id: cajaId } })
        .then((r) => r.data)
        .catch((e) => { if (e.response?.status === 404) return null; throw e; }),
    enabled: !!cajaId,
  });

  const { data: corte } = useQuery({
    queryKey: ['pos-corte', turno?.id],
    queryFn: () => api.get(`/pos/turnos/${turno.id}/corte`).then((r) => r.data),
    enabled: !!turno?.id,
  });

  const { data: historial = [] } = useQuery({
    queryKey: ['pos-turnos-historial', cajaId],
    queryFn: () =>
      api.get('/pos/turnos', { params: { caja_id: cajaId || undefined, estatus: 'cerrado' } })
        .then((r) => r.data),
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['pos-turno-actual'] });
    qc.invalidateQueries({ queryKey: ['pos-corte'] });
    qc.invalidateQueries({ queryKey: ['pos-turnos-historial'] });
    qc.invalidateQueries({ queryKey: ['pos-cajas'] });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Clock size={22} className="text-brand-500" />
        <h1 className="text-2xl font-bold text-gray-900">Caja y turnos</h1>
      </div>

      <div className="card mb-4 max-w-md">
        <label className="label">Caja</label>
        <select className="input" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
          <option value="">— Elegir caja —</option>
          {cajas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.sucursal_nombre} · {c.nombre}
            </option>
          ))}
        </select>
      </div>

      {cajaId && !cargandoTurno && !turno && (
        <AperturaTurno cajaId={cajaId} onAbierto={refrescar} />
      )}

      {turno && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Unlock size={16} className="text-green-600" /> Turno abierto
              </h2>
              <span className="badge-green">#{turno.id}</span>
            </div>
            <dl className="text-sm space-y-1.5">
              <Fila label="Cajero" valor={turno.cajero} />
              <Fila label="Apertura" valor={new Date(turno.abierto_en).toLocaleString('es-MX')} />
              <Fila label="Fondo inicial" valor={money(turno.fondo_inicial)} />
            </dl>
            <div className="flex gap-2 mt-4">
              <button className="btn-secondary" onClick={() => setModalMov('retiro')}>
                <MinusCircle size={15} /> Retiro
              </button>
              <button className="btn-secondary" onClick={() => setModalMov('deposito')}>
                <PlusCircle size={15} /> Depósito
              </button>
              <button className="btn-primary ml-auto" onClick={() => setModalCierre(true)}>
                <Lock size={15} /> Cerrar turno
              </button>
            </div>
          </div>

          {corte && (
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-3">Corte en curso</h2>
              <dl className="text-sm space-y-1.5">
                <Fila label="Ventas" valor={`${corte.num_ventas} (${money(corte.total_vendido)})`} />
                <Fila label="Efectivo en ventas" valor={money(corte.ventas_efectivo)} />
                <Fila label="Cambio entregado" valor={`− ${money(corte.cambio_entregado)}`} />
                <Fila label="Tarjeta" valor={money(corte.ventas_tarjeta)} />
                <Fila label="Depósitos" valor={money(corte.depositos)} />
                <Fila label="Retiros" valor={`− ${money(corte.retiros)}`} />
                <div className="border-t border-gray-100 pt-1.5">
                  <Fila
                    label={<span className="font-semibold">Efectivo esperado en caja</span>}
                    valor={<span className="font-semibold">{money(corte.efectivo_esperado)}</span>}
                  />
                </div>
              </dl>
              {!!corte.movimientos?.length && (
                <div className="mt-3 border-t border-gray-100 pt-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Movimientos</p>
                  {corte.movimientos.map((m) => (
                    <p key={m.id} className="text-xs text-gray-600">
                      {m.tipo === 'retiro' ? '−' : '+'} {money(m.monto)} · {m.motivo || 'sin motivo'} · {m.usuario}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Historial de turnos cerrados */}
      <div className="card mt-6 overflow-x-auto">
        <h2 className="font-semibold text-gray-900 mb-3">Turnos cerrados</h2>
        {!historial.length ? (
          <p className="text-sm text-gray-400">Sin turnos cerrados.</p>
        ) : (
          <table className="table-auto w-full">
            <thead>
              <tr>
                <th>Caja</th><th>Cajero</th><th>Apertura</th><th>Cierre</th>
                <th className="text-right">Esperado</th>
                <th className="text-right">Contado</th>
                <th className="text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((t) => (
                <tr key={t.id}>
                  <td>{t.sucursal} · {t.caja}</td>
                  <td>{t.cajero}</td>
                  <td>{new Date(t.abierto_en).toLocaleString('es-MX')}</td>
                  <td>{t.cerrado_en ? new Date(t.cerrado_en).toLocaleString('es-MX') : '—'}</td>
                  <td className="text-right">{money(t.efectivo_esperado)}</td>
                  <td className="text-right">{money(t.efectivo_contado)}</td>
                  <td className={`text-right font-medium ${Number(t.diferencia) === 0
                    ? 'text-green-600' : 'text-red-600'}`}>
                    {money(t.diferencia)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalMov && turno && (
        <ModalMovimiento
          tipo={modalMov}
          turnoId={turno.id}
          onClose={() => setModalMov(null)}
          onSaved={() => { setModalMov(null); refrescar(); }}
        />
      )}
      {modalCierre && turno && corte && (
        <ModalCierre
          turno={turno}
          corte={corte}
          confirmar={confirmar}
          onClose={() => setModalCierre(false)}
          onCerrado={() => { setModalCierre(false); refrescar(); }}
        />
      )}
      {dialogoConfirm}
    </div>
  );
}

function Fila({ label, valor }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 text-right">{valor}</dd>
    </div>
  );
}

export function AperturaTurno({ cajaId, onAbierto }) {
  const [fondo, setFondo] = useState('');
  const abrir = useMutation({
    mutationFn: () => api.post('/pos/turnos/abrir', { caja_id: cajaId, fondo_inicial: Number(fondo) }),
    onSuccess: () => { toast.success('Turno abierto'); onAbierto(); },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo abrir el turno'),
  });

  return (
    <div className="card max-w-md">
      <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <Unlock size={16} className="text-brand-500" /> Abrir turno
      </h2>
      <p className="text-sm text-gray-500 mb-3">
        No hay turno abierto en esta caja. Cuenta el fondo inicial para empezar.
      </p>
      <label className="label">Fondo inicial (efectivo)</label>
      <input
        className="input"
        type="number" min="0" step="0.01"
        value={fondo}
        onChange={(e) => setFondo(e.target.value)}
        placeholder="0.00"
      />
      <button
        className="btn-primary mt-3 w-full justify-center"
        disabled={abrir.isPending || fondo === '' || Number(fondo) < 0}
        onClick={() => abrir.mutate()}
      >
        Abrir turno
      </button>
    </div>
  );
}

function ModalMovimiento({ tipo, turnoId, onClose, onSaved }) {
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const guardar = useMutation({
    mutationFn: () => api.post(`/pos/turnos/${turnoId}/movimientos`, {
      tipo, monto: Number(monto), motivo,
    }),
    onSuccess: () => { toast.success(tipo === 'retiro' ? 'Retiro registrado' : 'Depósito registrado'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al registrar'),
  });

  return (
    <Modal title={tipo === 'retiro' ? 'Retiro de efectivo' : 'Depósito a caja'} onClose={onClose} size="sm">
      <div className="space-y-3">
        <div>
          <label className="label">Monto</label>
          <input className="input" type="number" min="0.01" step="0.01" autoFocus
            value={monto} onChange={(e) => setMonto(e.target.value)} />
        </div>
        <div>
          <label className="label">Motivo</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={tipo === 'retiro' ? 'Envío a bóveda, pago a proveedor…' : 'Cambio, reposición de fondo…'} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={guardar.isPending || !(Number(monto) > 0)}
            onClick={() => guardar.mutate()}>
            Registrar
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ModalCierre({ turno, corte, confirmar, onClose, onCerrado }) {
  const [contado, setContado] = useState('');
  const [notas, setNotas] = useState('');
  const diferencia = contado === '' ? null
    : Math.round((Number(contado) - corte.efectivo_esperado) * 100) / 100;

  const cerrar = useMutation({
    mutationFn: () => api.post(`/pos/turnos/${turno.id}/cerrar`, {
      efectivo_contado: Number(contado), notas,
    }),
    onSuccess: () => { toast.success('Turno cerrado'); onCerrado(); },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo cerrar el turno'),
  });

  async function onCerrar() {
    const msg = diferencia === 0
      ? 'El arqueo cuadra exacto. ¿Cerrar el turno?'
      : `Hay una diferencia de ${money(diferencia)} (contado − esperado).\nLa diferencia quedará registrada. ¿Cerrar el turno?`;
    if (!(await confirmar(msg, { titulo: 'Cerrar turno', textoConfirmar: 'Cerrar', danger: diferencia !== 0 }))) return;
    cerrar.mutate();
  }

  return (
    <Modal title="Cerrar turno (arqueo)" onClose={onClose} size="sm">
      <div className="space-y-3">
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Efectivo esperado</span>
            <span className="font-semibold">{money(corte.efectivo_esperado)}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-gray-500">Tarjeta</span>
            <span>{money(corte.ventas_tarjeta)}</span>
          </div>
        </div>
        <div>
          <label className="label">Efectivo contado físicamente</label>
          <input className="input" type="number" min="0" step="0.01" autoFocus
            value={contado} onChange={(e) => setContado(e.target.value)} />
        </div>
        {diferencia !== null && (
          <p className={`text-sm font-semibold ${diferencia === 0 ? 'text-green-600' : 'text-red-600'}`}>
            Diferencia: {money(diferencia)}
          </p>
        )}
        <div>
          <label className="label">Notas de cierre</label>
          <input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={cerrar.isPending || contado === '' || Number(contado) < 0}
            onClick={onCerrar}>
            Cerrar turno
          </button>
        </div>
      </div>
    </Modal>
  );
}
