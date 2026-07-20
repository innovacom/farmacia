import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, PlusCircle, MinusCircle, Lock, Unlock, ShieldAlert, ListTree } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useAuthStore } from '../../store/authStore';

const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/**
 * Caja y turnos (permiso pos-turnos): apertura con fondo, retiros/depósitos,
 * corte y cierre con arqueo. La diferencia (contado - esperado) se registra
 * y se muestra; el sistema nunca la ajusta.
 *
 * Arqueo ciego (migrate_v32): el backend NO envía efectivo_esperado a
 * cajeros (solo rol=admin lo recibe) para que nadie copie la cifra sin
 * contar. Si el conteo no cuadra se rechaza el cierre y se pide recontar;
 * al 3er fallo se exige la clave de supervisor de un admin (distinta a su
 * password de login), que entonces sí revela el esperado.
 */
export default function Turnos() {
  const qc = useQueryClient();
  const { confirmar, dialogoConfirm } = useConfirm();
  const esAdmin = useAuthStore((s) => s.user?.rol) === 'admin';
  const [cajaId, setCajaId] = useState(() => localStorage.getItem('pos-caja') || '');
  const [desgloseId, setDesgloseId] = useState(null);
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
              {esAdmin ? (
                <Fila label="Fondo inicial" valor={money(turno.fondo_inicial)} />
              ) : (
                <Fila label="Fondo inicial" valor={<span className="tracking-widest text-gray-400">***</span>} />
              )}
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
              {esAdmin ? (
                <>
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
                </>
              ) : (
                <div className="text-sm text-gray-500 space-y-2">
                  <p>
                    Arqueo ciego: ni el fondo, ni las ventas, ni los movimientos de caja se muestran
                    aquí para que nadie deduzca el efectivo esperado sin contarlo.
                  </p>
                  <Fila label="Tarjeta" valor={money(corte.ventas_tarjeta)} />
                  <p className="text-xs text-gray-400">
                    Al cerrar el turno cuenta el efectivo físicamente y captúralo; el sistema valida si cuadra.
                  </p>
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
                {esAdmin && <th></th>}
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
                  {esAdmin && (
                    <td className="text-right">
                      <button className="text-xs text-brand-500 hover:underline inline-flex items-center gap-1"
                        onClick={() => setDesgloseId(t.id)}>
                        <ListTree size={13} /> Desglose
                      </button>
                    </td>
                  )}
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
      {desgloseId && (
        <ModalDesglose turnoId={desgloseId} onClose={() => setDesgloseId(null)} />
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

/**
 * Arqueo ciego: `corte.efectivo_esperado` viene indefinido para cajeros (el
 * backend lo omite salvo rol=admin). El cajero cuenta el efectivo físico y
 * lo captura sin ver la cifra del sistema. Si no cuadra, se rechaza el
 * cierre y se pide recontar; al 3er fallo hay que llamar a un administrador
 * para que autorice con su clave de supervisor, momento en el que sí se
 * revela el esperado para capturarlo correctamente.
 */
function ModalCierre({ turno, corte, confirmar, onClose, onCerrado }) {
  const [contado, setContado] = useState('');
  const [notas, setNotas] = useState('');
  const [bloqueado, setBloqueado] = useState(false);
  const [intentosRestantes, setIntentosRestantes] = useState(null);
  const [clave, setClave] = useState('');
  const [autorizacion, setAutorizacion] = useState(null); // { efectivo_esperado, ventas_tarjeta }
  const esperadoVisible = corte.efectivo_esperado ?? autorizacion?.efectivo_esperado;

  const cerrar = useMutation({
    mutationFn: () => api.post(`/pos/turnos/${turno.id}/cerrar`, {
      efectivo_contado: Number(contado), notas,
    }),
    onSuccess: (res) => {
      const r = res.data;
      if (r.cerrado) {
        toast.success('Turno cerrado');
        onCerrado();
        return;
      }
      if (r.requiereSupervisor) {
        setBloqueado(true);
        toast.error('El arqueo no cuadra. Se requiere autorización de un supervisor.');
      } else {
        setIntentosRestantes(r.intentosRestantes);
        toast.error(`El conteo no cuadra. Vuelve a contar el efectivo (te quedan ${r.intentosRestantes} intento(s)).`);
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo cerrar el turno'),
  });

  const autorizar = useMutation({
    mutationFn: () => api.post(`/pos/turnos/${turno.id}/autorizar`, { clave }),
    onSuccess: (res) => {
      setAutorizacion(res.data);
      setBloqueado(false);
      setClave('');
      toast.success('Autorizado. Captura el efectivo esperado para cerrar.');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Clave de supervisor incorrecta'),
  });

  async function onCerrar() {
    if (autorizacion) {
      // Ya autorizado por supervisor: el cierre procede aunque no cuadre.
      cerrar.mutate();
      return;
    }
    if (!(await confirmar(
      'No verás el total esperado por el sistema: cuenta el efectivo físicamente y captura lo que cuentes.',
      { titulo: 'Cerrar turno (arqueo ciego)', textoConfirmar: 'Ya conté, continuar' }
    ))) return;
    cerrar.mutate();
  }

  return (
    <Modal title="Cerrar turno (arqueo)" onClose={onClose} size="sm">
      <div className="space-y-3">
        {bloqueado ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-3">
            <p className="text-sm text-red-700 flex items-start gap-2">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              El arqueo no cuadró en 3 intentos. Pide a un administrador su clave de supervisor para continuar.
            </p>
            <div>
              <label className="label">Clave de supervisor</label>
              <input className="input" type="password" autoFocus value={clave}
                onChange={(e) => setClave(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={onClose}>Cancelar</button>
              <button className="btn-primary" disabled={autorizar.isPending || !clave}
                onClick={() => autorizar.mutate()}>
                Autorizar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Efectivo esperado</span>
                <span className="font-semibold">
                  {esperadoVisible !== undefined
                    ? money(esperadoVisible)
                    : <span className="tracking-widest text-gray-400" title="Cuenta el efectivo antes de capturarlo">***</span>}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-500">Tarjeta</span>
                <span>{money(corte.ventas_tarjeta)}</span>
              </div>
            </div>
            {autorizacion && (
              <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2">
                Autorizado por supervisor. Captura el efectivo esperado arriba para cerrar el turno.
              </p>
            )}
            {!autorizacion && intentosRestantes !== null && (
              <p className="text-sm font-semibold text-red-600">
                El conteo no cuadró. Te quedan {intentosRestantes} intento(s).
              </p>
            )}
            <div>
              <label className="label">Efectivo contado físicamente</label>
              <input className="input" type="number" min="0" step="0.01" autoFocus
                value={contado} onChange={(e) => setContado(e.target.value)} />
            </div>
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
          </>
        )}
      </div>
    </Modal>
  );
}

function ModalDesglose({ turnoId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['pos-turno-desglose', turnoId],
    queryFn: () => api.get(`/pos/turnos/${turnoId}/desglose`).then((r) => r.data),
  });

  return (
    <Modal title="Desglose del cierre de caja" onClose={onClose} size="sm">
      {isLoading || !data ? (
        <p className="text-sm text-gray-400 py-6 text-center">Cargando…</p>
      ) : (
        <dl className="text-sm space-y-1.5">
          <Fila label="Fondo inicial" valor={money(data.fondo_inicial)} />
          <Fila label={`Ventas (${data.num_ventas})`} valor={money(data.total_vendido)} />
          <Fila label="Efectivo en ventas" valor={money(data.ventas_efectivo)} />
          <Fila label="Cambio entregado" valor={`− ${money(data.cambio_entregado)}`} />
          <Fila label="Tarjeta" valor={money(data.ventas_tarjeta)} />
          <Fila label="Depósitos" valor={money(data.depositos)} />
          <Fila label="Retiros" valor={`− ${money(data.retiros)}`} />
          <div className="border-t border-gray-100 pt-1.5">
            <Fila label={<span className="font-semibold">Efectivo esperado</span>}
              valor={<span className="font-semibold">{money(data.efectivo_esperado)}</span>} />
            <Fila label="Efectivo contado" valor={money(data.efectivo_contado)} />
            <Fila label="Diferencia" valor={
              <span className={Number(data.diferencia) === 0 ? 'text-green-600' : 'text-red-600'}>
                {money(data.diferencia)}
              </span>} />
          </div>
          <div className="border-t border-gray-100 pt-1.5">
            <Fila label="Cerrado por" valor={data.cerrado_por || '—'} />
            <Fila label="Cerrado en" valor={data.cerrado_en ? new Date(data.cerrado_en).toLocaleString('es-MX') : '—'} />
            {data.autorizado_por && <Fila label="Autorizado por" valor={data.autorizado_por} />}
            {data.notas_cierre && <Fila label="Notas" valor={data.notas_cierre} />}
          </div>
          {!!data.movimientos?.length && (
            <div className="mt-2 border-t border-gray-100 pt-2">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Movimientos</p>
              {data.movimientos.map((m) => (
                <p key={m.id} className="text-xs text-gray-600">
                  {m.tipo === 'retiro' ? '−' : '+'} {money(m.monto)} · {m.motivo || 'sin motivo'} · {m.usuario}
                </p>
              ))}
            </div>
          )}
        </dl>
      )}
    </Modal>
  );
}
