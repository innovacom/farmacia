import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { ShieldAlert } from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

// Se muestra en vez del sistema cuando user.debe_cambiar_password es true
// (ver App.jsx#RequireAuth) — hoy solo le pasa al admin sembrado por
// seed.js, cuya contraseña inicial (Admin1234!) está documentada en el
// repo. No hay forma de "saltarla": no navega a ningún lado hasta que el
// backend confirma el cambio y reemite el token.
export default function CambiarPasswordObligatorio() {
  const { register, handleSubmit, watch, formState: { errors } } = useForm();
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.token);

  async function onSubmit(data) {
    setLoading(true);
    try {
      const res = await api.post('/auth/cambiar-password', {
        passwordActual: data.passwordActual,
        passwordNuevo: data.passwordNuevo,
      });
      setAuth(res.data.token, res.data.user);
      toast.success('Contraseña actualizada');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al cambiar la contraseña');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-500 to-brand-700
                    flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <ShieldAlert className="w-10 h-10 text-brand-600 mx-auto mb-2" />
          <h1 className="text-lg font-bold text-gray-900">Cambia tu contraseña</h1>
          <p className="text-sm text-gray-500 mt-1">
            Es tu primer acceso con la contraseña inicial. Debes definir una propia antes de continuar.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Contraseña actual</label>
            <input
              type="password"
              className="input"
              autoComplete="current-password"
              {...register('passwordActual', { required: 'Requerido' })}
            />
            {errors.passwordActual && <p className="text-xs text-red-500 mt-1">{errors.passwordActual.message}</p>}
          </div>

          <div>
            <label className="label">Contraseña nueva</label>
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              {...register('passwordNuevo', {
                required: 'Requerido',
                minLength: { value: 8, message: 'Mínimo 8 caracteres' },
              })}
            />
            {errors.passwordNuevo && <p className="text-xs text-red-500 mt-1">{errors.passwordNuevo.message}</p>}
          </div>

          <div>
            <label className="label">Confirmar contraseña nueva</label>
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              {...register('passwordConfirmar', {
                required: 'Requerido',
                validate: (v) => v === watch('passwordNuevo') || 'No coincide con la contraseña nueva',
              })}
            />
            {errors.passwordConfirmar && <p className="text-xs text-red-500 mt-1">{errors.passwordConfirmar.message}</p>}
          </div>

          <button
            type="submit"
            disabled={loading || !token}
            className="btn-primary w-full justify-center py-2.5 mt-2"
          >
            {loading ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
}
