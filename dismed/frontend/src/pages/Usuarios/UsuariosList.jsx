import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Loader2, Users, ShieldCheck, User, Eye, EyeOff, Search } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import { useConfirm } from '../../components/ui/ConfirmDialog';

function RolBadge({ rol }) {
  return rol === 'admin'
    ? <span className="inline-flex items-center gap-1 text-xs font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full"><ShieldCheck size={11} /> Admin</span>
    : <span className="inline-flex items-center gap-1 text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"><User size={11} /> Operador</span>;
}

export default function UsuariosList() {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { confirmar, dialogoConfirm } = useConfirm();
  const [showModal, setShowModal]     = useState(false);
  const [editando, setEditando]       = useState(null);
  const [verPassword, setVerPassword] = useState(false);
  const [q, setQ] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => api.get('/usuarios').then((r) => r.data),
  });

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return data;
    return data.filter((u) =>
      `${u.nombre} ${u.email} ${u.puesto || ''}`.toLowerCase().includes(t)
    );
  }, [data, q]);

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(filtrados);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm();
  const esEdicion = Boolean(editando);

  const guardarMut = useMutation({
    // Solo los campos del formulario: nada de jefe_nombre/created_at ni password vacío.
    mutationFn: (d) => {
      const payload = {
        nombre:  d.nombre,
        puesto:  d.puesto || null,
        rol:     d.rol,
        email:   d.email,
        jefe_id: d.jefe_id || null,
        activo:  d.activo ? 1 : 0,
      };
      if (d.password) payload.password = d.password;
      return esEdicion
        ? api.put(`/usuarios/${editando.id}`, payload)
        : api.post('/usuarios', payload);
    },
    onSuccess: () => {
      toast.success(esEdicion ? 'Usuario actualizado' : 'Usuario creado');
      qc.invalidateQueries(['usuarios']);
      cerrarModal();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  const desactivarMut = useMutation({
    mutationFn: (id) => api.delete(`/usuarios/${id}`),
    onSuccess: () => {
      toast.success('Usuario desactivado');
      qc.invalidateQueries(['usuarios']);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const reactivarMut = useMutation({
    mutationFn: ({ id, data }) => api.put(`/usuarios/${id}`, data),
    onSuccess: () => {
      toast.success('Usuario reactivado');
      qc.invalidateQueries(['usuarios']);
    },
  });

  function abrirNuevo() {
    setEditando(null);
    reset({ rol: 'operador', activo: 1 });
    setVerPassword(false);
    setShowModal(true);
  }

  function abrirEditar(u) {
    setEditando(u);
    reset({
      nombre:   u.nombre,
      puesto:   u.puesto || '',
      rol:      u.rol,
      email:    u.email,
      jefe_id:  u.jefe_id || '',
      activo:   !!u.activo,
      password: '',
    });
    setVerPassword(false);
    setShowModal(true);
  }

  function cerrarModal() {
    setShowModal(false);
    setEditando(null);
    reset();
  }

  // Otros usuarios disponibles como jefe (excluir al mismo usuario)
  const posiblesJefes = data.filter((u) => u.activo && (!editando || u.id !== editando.id));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">Equipo con acceso al sistema</p>
        </div>
        <button onClick={abrirNuevo} className="btn-primary">
          <Plus size={16} /> Nuevo usuario
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por nombre, correo o puesto…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : data.length === 0 ? (
          <div className="text-center py-12">
            <Users size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">Sin usuarios registrados</p>
            <button onClick={abrirNuevo} className="btn-primary mt-4">Agregar primero</button>
          </div>
        ) : filtrados.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Sin resultados con la búsqueda</p>
        ) : (
          <table className="table-auto w-full">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Puesto</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Jefe directo</th>
                <th className="text-center">Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((u) => (
                <tr key={u.id} className={!u.activo ? 'opacity-50' : ''}>
                  <td>
                    <p className="font-medium">{u.nombre}</p>
                    {u.id === currentUser?.id && (
                      <p className="text-xs text-brand-500">(tú)</p>
                    )}
                  </td>
                  <td className="text-gray-600">{u.puesto || '—'}</td>
                  <td className="text-gray-600 text-sm">{u.email}</td>
                  <td><RolBadge rol={u.rol} /></td>
                  <td className="text-gray-600 text-sm">{u.jefe_nombre || '—'}</td>
                  <td className="text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => abrirEditar(u)} className="text-xs text-brand-500 hover:underline">
                        Editar
                      </button>
                      {u.id !== currentUser?.id && (
                        u.activo
                          ? <button
                              onClick={async () => {
                                if (await confirmar(`¿Desactivar a "${u.nombre}"? Perderá el acceso al sistema.`,
                                  { titulo: 'Desactivar usuario', textoConfirmar: 'Desactivar' })) {
                                  desactivarMut.mutate(u.id);
                                }
                              }}
                              className="text-xs text-red-400 hover:underline"
                            >
                              Desactivar
                            </button>
                          : <button
                              onClick={() => reactivarMut.mutate({ id: u.id, data: { ...u, activo: 1 } })}
                              className="text-xs text-green-600 hover:underline"
                            >
                              Reactivar
                            </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!isLoading && (
          <Pagination page={page} totalPages={totalPages} total={total} from={from} to={to} onChange={setPage} />
        )}
      </div>

      {showModal && (
        <Modal
          title={esEdicion ? `Editar: ${editando.nombre}` : 'Nuevo usuario'}
          onClose={cerrarModal}
        >
          <form onSubmit={handleSubmit((d) => guardarMut.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">

              <div className="col-span-2">
                <label className="label">Nombre completo *</label>
                <input className="input" {...register('nombre', { required: 'Requerido' })} />
                {errors.nombre && <p className="text-xs text-red-500 mt-1">{errors.nombre.message}</p>}
              </div>

              <div>
                <label className="label">Puesto / cargo</label>
                <input className="input" placeholder="Ej: Ejecutivo de Ventas" {...register('puesto')} />
              </div>

              <div>
                <label className="label">Rol</label>
                <select className="input" {...register('rol')}>
                  <option value="operador">Operador</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="label">Correo electrónico *</label>
                <input type="email" className="input" {...register('email', { required: 'Requerido' })} />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
              </div>

              <div className="col-span-2">
                <label className="label">
                  {esEdicion ? 'Nueva contraseña (dejar en blanco para no cambiar)' : 'Contraseña *'}
                </label>
                <div className="relative">
                  <input
                    type={verPassword ? 'text' : 'password'}
                    className="input pr-10"
                    autoComplete="new-password"
                    {...register('password', {
                      required: esEdicion ? false : 'Requerido',
                      minLength: { value: 6, message: 'Mínimo 6 caracteres' },
                    })}
                  />
                  <button
                    type="button"
                    onClick={() => setVerPassword(!verPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  >
                    {verPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
              </div>

              <div className="col-span-2">
                <label className="label">Jefe directo (quien autoriza sus cotizaciones)</label>
                <select className="input" {...register('jefe_id')}>
                  <option value="">— Sin jefe asignado —</option>
                  {posiblesJefes.map((j) => (
                    <option key={j.id} value={j.id}>{j.nombre}{j.puesto ? ` — ${j.puesto}` : ''}</option>
                  ))}
                </select>
              </div>

              {esEdicion && (
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" id="activo" className="rounded" {...register('activo')} />
                  <label htmlFor="activo" className="text-sm text-gray-700">Usuario activo</label>
                </div>
              )}

            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={guardarMut.isPending} className="btn-primary">
                {guardarMut.isPending && <Loader2 size={15} className="animate-spin" />}
                {esEdicion ? 'Guardar cambios' : 'Crear usuario'}
              </button>
              <button type="button" onClick={cerrarModal} className="btn-secondary">
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {dialogoConfirm}
    </div>
  );
}
