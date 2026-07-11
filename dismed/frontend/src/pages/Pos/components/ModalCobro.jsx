import { useState, useMemo } from 'react';
import Modal from '../../../components/ui/Modal';

const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const DENOMINACIONES = [50, 100, 200, 500, 1000];

/**
 * Cobro con pago mixto (efectivo + tarjeta) y cambio en vivo.
 * El client_uuid se genera al abrir el modal: un doble clic o un reintento
 * de red NO duplican la venta (el backend es idempotente por uuid).
 */
const USOS_CFDI = [
  ['G03', 'G03 — Gastos en general'],
  ['G01', 'G01 — Adquisición de mercancías'],
  ['D01', 'D01 — Honorarios médicos y gastos hospitalarios'],
  ['D02', 'D02 — Gastos médicos por incapacidad'],
  ['S01', 'S01 — Sin efectos fiscales'],
];

export default function ModalCobro({ total, isPending, onClose, onConfirmar }) {
  const [efectivo, setEfectivo] = useState('');
  const [tarjeta, setTarjeta] = useState('');
  const [conFactura, setConFactura] = useState(false);
  const [receptor, setReceptor] = useState({
    rfc: '', razon_social: '', codigo_postal: '', regimen_fiscal: '612', uso_cfdi: 'G03',
  });
  const setR = (k, v) => setReceptor((r) => ({ ...r, [k]: v }));
  const clientUuid = useMemo(() => crypto.randomUUID(), []);
  const receptorValido = !conFactura || (
    receptor.rfc.trim().length >= 12 && receptor.razon_social.trim()
    && receptor.codigo_postal.trim().length === 5 && receptor.regimen_fiscal && receptor.uso_cfdi
  );

  const ef = Number(efectivo || 0);
  const tj = Number(tarjeta || 0);
  const cubierto = ef + tj >= total - 0.005;
  const tarjetaExcede = tj > total + 0.005;
  const cambio = Math.max(0, Math.round((ef - (total - tj)) * 100) / 100);

  return (
    <Modal title="Cobrar" onClose={onClose} size="md">
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-sm text-gray-500">Total a cobrar</p>
          <p className="text-5xl font-bold text-gray-900">{money(total)}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Efectivo</label>
            <input
              className="input py-3 text-xl text-right"
              type="number" min="0" step="0.01" autoFocus
              value={efectivo}
              onChange={(e) => setEfectivo(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {DENOMINACIONES.map((d) => (
                <button key={d} type="button" className="btn-secondary btn-sm"
                  onClick={() => setEfectivo(String(d))}>
                  ${d}
                </button>
              ))}
              <button type="button" className="btn-secondary btn-sm"
                onClick={() => setEfectivo(String(Math.max(0, Math.round((total - tj) * 100) / 100)))}>
                Exacto
              </button>
            </div>
          </div>
          <div>
            <label className="label">Tarjeta</label>
            <input
              className="input py-3 text-xl text-right"
              type="number" min="0" step="0.01"
              value={tarjeta}
              onChange={(e) => setTarjeta(e.target.value)}
            />
            <button type="button" className="btn-secondary btn-sm mt-2"
              onClick={() => { setTarjeta(String(total)); setEfectivo('0'); }}>
              Todo con tarjeta
            </button>
          </div>
        </div>

        <div className={`rounded-lg p-3 text-center ${cubierto ? 'bg-green-50' : 'bg-gray-50'}`}>
          {tarjetaExcede ? (
            <p className="text-sm font-semibold text-red-600">La tarjeta no puede exceder el total</p>
          ) : cubierto ? (
            <p className="text-lg font-bold text-green-700">Cambio: {money(cambio)}</p>
          ) : (
            <p className="text-sm text-gray-500">
              Faltan {money(Math.max(0, total - ef - tj))}
            </p>
          )}
        </div>

        {/* Factura individual en caja (el cliente da su RFC) */}
        <div className="border-t border-gray-100 pt-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={conFactura} onChange={(e) => setConFactura(e.target.checked)} />
            El cliente requiere factura (CFDI)
          </label>
          {conFactura && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input className="input font-mono" placeholder="RFC" maxLength={13}
                value={receptor.rfc} onChange={(e) => setR('rfc', e.target.value.toUpperCase())} />
              <input className="input" placeholder="Razón social / nombre"
                value={receptor.razon_social} onChange={(e) => setR('razon_social', e.target.value)} />
              <input className="input" placeholder="C.P. fiscal" maxLength={5}
                value={receptor.codigo_postal} onChange={(e) => setR('codigo_postal', e.target.value)} />
              <input className="input" placeholder="Régimen fiscal (ej. 612)" maxLength={3}
                value={receptor.regimen_fiscal} onChange={(e) => setR('regimen_fiscal', e.target.value)} />
              <select className="input col-span-2" value={receptor.uso_cfdi}
                onChange={(e) => setR('uso_cfdi', e.target.value)}>
                {USOS_CFDI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-pos-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn-pos-primary"
            disabled={!cubierto || tarjetaExcede || isPending || !receptorValido}
            onClick={() => onConfirmar({
              efectivo: ef, tarjeta: tj, client_uuid: clientUuid,
              receptor: conFactura ? receptor : null,
            })}
          >
            {isPending ? 'Registrando…' : 'Confirmar cobro'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
