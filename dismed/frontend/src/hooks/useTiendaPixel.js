import { useEffect } from 'react';
import { initTiendaPixel } from '../utils/tiendaPixel';

// Inicializa el Pixel de Meta/TikTok en cuanto GET /tienda/info trae los IDs.
// initTiendaPixel() ya es idempotente (solo carga los scripts una vez), así
// que se puede llamar desde cada página de /tienda sin cuidado.
// Ver DISEÑO_ADS_META_TIKTOK.md.
export default function useTiendaPixel(info) {
  useEffect(() => {
    if (info) initTiendaPixel(info);
  }, [info]);
}
