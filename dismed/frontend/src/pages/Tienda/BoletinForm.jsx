// Suscripción a boletín en el pie de /tienda — POST /tienda/suscriptores
// (tienda.controller.js#suscribir). react-hot-toast ya está montado
// globalmente en main.jsx (fuera de RequireAuth), así que funciona aquí sin
// configuración extra.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

export default function BoletinForm() {
  const [email, setEmail] = useState('');

  const suscribir = useMutation({
    mutationFn: () => api.post('/tienda/suscriptores', { email }),
    onSuccess: () => { toast.success('¡Listo! Ya estás suscrito.'); setEmail(''); },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo suscribir'),
  });

  return (
    <div className="max-w-md mx-auto text-center">
      <p className="font-tienda-display font-bold text-tienda-ink flex items-center justify-center gap-1.5">
        <Mail size={16} className="text-tienda-teal" /> Recibe nuestras ofertas
      </p>
      <p className="text-sm text-tienda-muted mt-1 mb-3">
        Déjanos tu correo y te avisamos de promociones y novedades.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (email.trim()) suscribir.mutate(); }}
      >
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@correo.com"
          className="flex-1 rounded-xl border border-tienda-ink/10 bg-white px-3 py-2 text-sm
                     placeholder-tienda-muted/70 focus:outline-none focus:ring-2
                     focus:ring-tienda-teal/30 focus:border-tienda-teal transition-shadow"
        />
        <button
          type="submit" disabled={suscribir.isPending}
          className="rounded-xl bg-tienda-teal text-white text-sm font-semibold px-4 py-2
                     hover:bg-tienda-teal/90 transition-colors disabled:opacity-50 shrink-0"
        >
          {suscribir.isPending ? 'Enviando…' : 'Suscribirme'}
        </button>
      </form>
    </div>
  );
}
