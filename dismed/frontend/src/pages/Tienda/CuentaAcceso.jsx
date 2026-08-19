// Acceso a "Mi cuenta" sin contraseña: teléfono → código de 6 dígitos por
// WhatsApp → sesión. Dos pasos en una sola pantalla (ver
// tienda.cuenta.service.js#solicitarCodigo/verificarCodigo). El campo
// "Nombre" solo se usa si el teléfono resulta ser nuevo (el backend lo
// ignora si el teléfono ya tiene cuenta) — se pide de una vez para no
// necesitar una tercera pantalla de "completa tu perfil".
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/apiTienda';
import { useTiendaAuth } from '../../store/tiendaAuthStore';
import useTituloPagina from '../../hooks/useTituloPagina';

const inputCls = 'w-full rounded-xl border border-tienda-ink/10 bg-white px-3 py-2.5 text-sm '
  + 'focus:outline-none focus:ring-2 focus:ring-tienda-teal/30 focus:border-tienda-teal';

export default function CuentaAcceso() {
  const navigate = useNavigate();
  const { token, setSesion } = useTiendaAuth();
  const [paso, setPaso] = useState('telefono'); // 'telefono' | 'codigo'
  const [telefono, setTelefono] = useState('');
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');

  useTituloPagina({ titulo: 'Mi cuenta' });

  useEffect(() => {
    if (token) navigate('/tienda/mi-cuenta', { replace: true });
  }, [token, navigate]);

  const pedirCodigo = useMutation({
    mutationFn: () => api.post('/tienda/cuenta/codigo', { telefono: telefono.trim() }).then((r) => r.data),
    onSuccess: () => { setPaso('codigo'); toast.success('Te enviamos un código por WhatsApp.'); },
    onError: (e) => toast.error(e.response?.data?.error || 'No se pudo enviar el código'),
  });

  const verificar = useMutation({
    mutationFn: () => api.post('/tienda/cuenta/verificar', {
      telefono: telefono.trim(), codigo: codigo.trim(), nombre: nombre.trim() || undefined,
    }).then((r) => r.data),
    onSuccess: ({ token: t, cliente }) => {
      setSesion(t, cliente);
      toast.success(`¡Hola, ${cliente.nombre}!`);
      navigate('/tienda/mi-cuenta', { replace: true });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Código incorrecto'),
  });

  return (
    <div className="min-h-screen bg-tienda-surface font-tienda text-tienda-ink">
      <header className="sticky top-0 z-10 bg-gradient-to-b from-tienda-tealsoft to-tienda-surface border-b border-tienda-teal/10">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/tienda" className="text-tienda-teal hover:text-tienda-teal/70 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="font-tienda-display text-lg font-extrabold text-tienda-ink tracking-tight">
            Mi cuenta
          </h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-tienda-ink/5 p-5 space-y-4">
          {paso === 'telefono' ? (
            <>
              <div className="flex items-center gap-2 text-tienda-teal">
                <MessageCircle size={20} />
                <p className="font-tienda-display font-bold">Entra con tu WhatsApp</p>
              </div>
              <p className="text-sm text-tienda-muted">
                Sin contraseña: te mandamos un código de 6 dígitos por WhatsApp para entrar o crear tu cuenta.
              </p>
              <div>
                <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">
                  Tu WhatsApp (10 dígitos)
                </label>
                <input
                  className={inputCls} inputMode="numeric" placeholder="55 1234 5678"
                  value={telefono} onChange={(e) => setTelefono(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && pedirCodigo.mutate()}
                />
              </div>
              <button
                type="button" disabled={!telefono.trim() || pedirCodigo.isPending}
                onClick={() => pedirCodigo.mutate()}
                className="w-full flex items-center justify-center gap-2 bg-tienda-teal hover:bg-tienda-teal/90
                           text-white font-tienda-display font-bold px-4 py-3 rounded-2xl transition-transform
                           hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {pedirCodigo.isPending ? 'Enviando…' : 'Enviarme el código'}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-tienda-teal">
                <ShieldCheck size={20} />
                <p className="font-tienda-display font-bold">Escribe tu código</p>
              </div>
              <p className="text-sm text-tienda-muted">
                Enviamos un código de 6 dígitos a {telefono}. Vence en 10 minutos.
              </p>
              <div>
                <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">Código</label>
                <input
                  className={`${inputCls} text-center text-lg tracking-[0.3em] font-tienda-display font-bold`}
                  inputMode="numeric" maxLength={6} placeholder="000000"
                  value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && codigo.length === 6 && verificar.mutate()}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-tienda-muted uppercase tracking-wide mb-2">
                  Tu nombre (solo si es tu primera vez)
                </label>
                <input className={inputCls} value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </div>
              <button
                type="button" disabled={codigo.length !== 6 || verificar.isPending}
                onClick={() => verificar.mutate()}
                className="w-full flex items-center justify-center gap-2 bg-tienda-teal hover:bg-tienda-teal/90
                           text-white font-tienda-display font-bold px-4 py-3 rounded-2xl transition-transform
                           hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {verificar.isPending ? 'Verificando…' : 'Entrar'}
              </button>
              <button
                type="button" onClick={() => { setPaso('telefono'); setCodigo(''); }}
                className="w-full text-center text-xs text-tienda-muted hover:text-tienda-teal"
              >
                Usar otro número o pedir el código de nuevo
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
