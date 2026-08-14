import { useEffect } from 'react';

// Título/descripción por página del catálogo público — sirve para Google
// (Googlebot sí ejecuta JS y recoge document.title/meta description), NO
// para la vista previa de WhatsApp/Facebook (esos bots leen el HTML crudo de
// index.html, que trae sus propios og:* fijos — ver index.html). Sin
// dependencia nueva: no hay react-helmet instalado y no se justifica para
// esto. Restaura el título anterior al desmontar para no dejar "pegado" el
// de una página al navegar con back/forward del navegador.
export default function useTituloPagina({ titulo, descripcion }) {
  useEffect(() => {
    if (!titulo) return;
    const tituloAnterior = document.title;
    document.title = titulo;

    let meta = document.querySelector('meta[name="description"]');
    const descripcionAnterior = meta?.getAttribute('content');
    if (descripcion) {
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'description');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', descripcion);
    }

    return () => {
      document.title = tituloAnterior;
      if (meta && descripcionAnterior !== undefined) meta.setAttribute('content', descripcionAnterior);
    };
  }, [titulo, descripcion]);
}
