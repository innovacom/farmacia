import { useCallback } from 'react';

const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/**
 * Ticket térmico (58/80mm) impreso con window.print():
 * - El nodo vive oculto (.ticket-print) y solo es visible al imprimir con
 *   body.imprimiendo-ticket (ver index.css).
 * - La regla @page (tamaño y margen) se inyecta en un <style> temporal para
 *   no pisar la impresión carta de reportes.
 * - Con Chrome en modo kiosko (--kiosk-printing) sale sin diálogo; el cajón
 *   lo abre el driver de la impresora ("open drawer before printing").
 * Branding: logo de ticket, nombre comercial y leyenda del pie vienen de
 * /empresas/mi-branding (useBranding) — nada hardcodeado.
 */
export function usePrintTicket(branding) {
  return useCallback(() => {
    const ancho = branding?.config?.ticket_ancho_mm === '58' ? '58mm' : '80mm';
    document.documentElement.style.setProperty('--ticket-ancho', ancho);
    const style = document.createElement('style');
    style.textContent = `@page { size: ${ancho} auto; margin: 0; }`;
    document.head.appendChild(style);
    document.body.classList.add('imprimiendo-ticket');
    try {
      window.print();
    } finally {
      document.body.classList.remove('imprimiendo-ticket');
      style.remove();
    }
  }, [branding]);
}

export default function TicketPrint({ venta, branding }) {
  if (!venta) return null;
  const cfg = branding?.config || {};
  const nombre = branding?.nombre_comercial || 'DISMED';
  const logo = branding?.logo_ticket_url || branding?.logo_url;

  return (
    <div className="ticket-print" style={{ padding: '2mm 3mm' }}>
      <div style={{ textAlign: 'center' }}>
        {logo && (
          <img src={logo} alt="" style={{ maxWidth: '60%', maxHeight: '18mm', objectFit: 'contain' }} />
        )}
        <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{nombre}</div>
        {branding?.rfc && <div>RFC: {branding.rfc}</div>}
        <div>{venta.sucursal}</div>
        {venta.sucursal_direccion && <div>{venta.sucursal_direccion}</div>}
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '2mm 0' }} />
      <div>Ticket: <b>{venta.folio}</b></div>
      <div>{new Date(venta.created_at).toLocaleString('es-MX')}</div>
      <div>Caja: {venta.caja} · Cajero: {venta.cajero}</div>
      <div style={{ borderTop: '1px dashed #000', margin: '2mm 0' }} />

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {(venta.partidas || []).map((p) => (
            <tr key={p.id}>
              <td style={{ verticalAlign: 'top', paddingRight: '2mm' }}>
                {Number(p.cantidad)} ×
              </td>
              <td style={{ width: '100%' }}>{p.descripcion}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(p.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ borderTop: '1px dashed #000', margin: '2mm 0' }} />
      <table style={{ width: '100%' }}>
        <tbody>
          <tr><td>Subtotal</td><td style={{ textAlign: 'right' }}>{money(venta.subtotal)}</td></tr>
          <tr><td>IVA</td><td style={{ textAlign: 'right' }}>{money(venta.iva)}</td></tr>
          <tr style={{ fontWeight: 'bold', fontSize: '13px' }}>
            <td>TOTAL</td><td style={{ textAlign: 'right' }}>{money(venta.total)}</td>
          </tr>
          {Number(venta.pago_efectivo) > 0 && (
            <tr><td>Efectivo</td><td style={{ textAlign: 'right' }}>{money(venta.pago_efectivo)}</td></tr>
          )}
          {Number(venta.pago_tarjeta) > 0 && (
            <tr><td>Tarjeta</td><td style={{ textAlign: 'right' }}>{money(venta.pago_tarjeta)}</td></tr>
          )}
          {Number(venta.cambio) > 0 && (
            <tr><td>Cambio</td><td style={{ textAlign: 'right' }}>{money(venta.cambio)}</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ borderTop: '1px dashed #000', margin: '2mm 0' }} />
      <div style={{ textAlign: 'center' }}>
        {cfg.ticket_mostrar_leyenda_factura !== '0' && (
          <div>¿Requiere factura? Preséntese en caja con su RFC y el folio {venta.folio}.</div>
        )}
        <div style={{ marginTop: '1mm', fontWeight: 'bold' }}>
          {cfg.ticket_leyenda_pie || '¡Gracias por su compra!'}
        </div>
      </div>
    </div>
  );
}
