import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

/**
 * useBranding — branding de la empresa del usuario (white-label POS).
 * Consulta GET /empresas/mi-branding y aplica el color primario a las
 * variables --brand-* (ver index.css / tailwind.config.js) generando la
 * escala 50–700 por desplazamiento de luminosidad HSL. También ajusta el
 * título del documento. Sin branding configurado no toca nada: quedan los
 * defaults INNOVACOM del CSS.
 */

const DEFAULT_PRIMARIO = '#1a6bb5';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  let h = 0; let s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

/** Escala 50–700 a partir del color base (500), por luminosidad HSL. */
export function escalaBrand(hexPrimario) {
  const [h, s, l] = rgbToHsl(hexToRgb(hexPrimario));
  const tono = (nl, ns = s) => hslToRgb([h, ns, nl]).join(' ');
  return {
    50: tono(0.97, Math.min(s, 0.85)),
    100: tono(0.93, Math.min(s, 0.85)),
    500: tono(l),
    600: tono(Math.max(l - 0.06, 0.08)),
    700: tono(Math.max(l - 0.12, 0.06)),
  };
}

function aplicarColores(hexPrimario) {
  const escala = escalaBrand(hexPrimario);
  const root = document.documentElement;
  for (const [nivel, rgb] of Object.entries(escala)) {
    root.style.setProperty(`--brand-${nivel}`, rgb);
  }
}

export function useBranding() {
  const { data: branding } = useQuery({
    queryKey: ['mi-branding'],
    queryFn: () => api.get('/empresas/mi-branding').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (!branding) return;
    aplicarColores(branding.color_primario || DEFAULT_PRIMARIO);
    if (branding.nombre_comercial) {
      document.title = `${branding.nombre_comercial} — ERP`;
    }
  }, [branding]);

  return branding || null;
}
