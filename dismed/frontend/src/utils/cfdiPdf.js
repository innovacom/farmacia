import toast from 'react-hot-toast';
import api from '../services/api';

/**
 * Pide al backend la representación impresa (PDF) del CFDI `id` y la abre
 * en una pestaña nueva. Usa blob (no una URL directa) porque el endpoint
 * exige JWT — un <a href> o window.open a la URL cruda no llevaría el header.
 */
export async function abrirPdfCfdi(id) {
  const toastId = toast.loading('Generando PDF…');
  try {
    const res = await api.get(`/cfdi/comprobante/${id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    window.open(url, '_blank');
    toast.dismiss(toastId);
  } catch (e) {
    let msg = 'No se pudo generar el PDF del CFDI';
    if (e.response?.data instanceof Blob) {
      try {
        const text = await e.response.data.text();
        msg = JSON.parse(text).error || msg;
      } catch { /* deja el mensaje genérico */ }
    } else {
      msg = e.response?.data?.error || msg;
    }
    toast.error(msg, { id: toastId });
  }
}
