import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

export default function Login() {
  const { register, handleSubmit, formState: { errors } } = useForm();
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  async function onSubmit(data) {
    setLoading(true);
    try {
      const res = await api.post('/auth/login', data);
      setAuth(res.data.token, res.data.user);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-500 to-brand-700
                    flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/logo_innovacom.png" alt="INNOVACOM" className="w-24 h-24 object-contain mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900">INNOVACOM</h1>
          <p className="text-sm text-gray-500 mt-1">ERP Distribución Médica</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Correo electrónico</label>
            <input
              type="email"
              className="input"
              placeholder="admin@dismed.mx"
              {...register('email', { required: 'Requerido' })}
            />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label className="label">Contraseña</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              {...register('password', { required: 'Requerido' })}
            />
            {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center py-2.5 mt-2"
          >
            {loading ? 'Iniciando sesión…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
