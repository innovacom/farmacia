import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Loader2, HeartPulse, Search } from 'lucide-react';
import api from '../../services/api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';

const SEXOS = [
  { value: 'M', label: 'Masculino' },
  { value: 'F', label: 'Femenino' },
  { value: 'X', label: 'Otro / sin especificar' },
];

function edad(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const hoy = new Date();
  const nac = new Date(fechaNacimiento);
  let a = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) a--;
  return a;
}

export default function PacientesList() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [q, setQ] = useState('');

  const { data: pacientes = [], isLoading } = useQuery({
    queryKey: ['expediente-pacientes'],
    queryFn: () => api.get('/expediente/pacientes').then((r) => r.data),
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => api.get('/clientes', { params: { activos: '1' } }).then((r) => r.data),
  });

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return pacientes;
    return pacientes.filter((p) =>
      `${p.nombre} ${p.apellido_paterno || ''} ${p.apellido_materno || ''} ${p.curp || ''}`
        .toLowerCase().includes(t)
    );
  }, [pacientes, q]);

  const { pageItems, page, setPage, totalPages, total, from, to } = usePagination(filtrados);

  const { register, handleSubmit, reset, formState: { errors } } = useForm();

  const crearMut = useMutation({
    mutationFn: (data) => api.post('/expediente/pacientes', data),
    onSuccess: () => {
      toast.success('Paciente creado');
      qc.invalidateQueries(['expediente-pacientes']);
      setShowModal(false);
      reset();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expediente Médico</h1>
          <p className="text-sm text-gray-400">Pacientes de los clientes (hospitales/clínicas) de DISMED</p>
        </div>
        <button onClick={() => { reset({}); setShowModal(true); }} className="btn-primary">
          <Plus size={16} /> Nuevo paciente
        </button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Buscar por nombre o CURP…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Cargando…</p>
        ) : pacientes.length === 0 ? (
          <div className="text-center py-12">
            <HeartPulse size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400">Sin pacientes registrados</p>
            <button onClick={() => { reset({}); setShowModal(true); }} className="btn-primary mt-4">
              Agregar primero
            </button>
          </div>
        ) : filtrados.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Sin resultados con la búsqueda</p>
        ) : (
          <table className="table-auto w-full">
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Cliente (hospital/clínica)</th>
                <th className="text-center">Edad</th>
                <th>CURP</th>
                <th>Contacto</th>
                <th className="text-center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((p) => (
                <tr
                  key={p.id}
                  className={`cursor-pointer hover:bg-gray-50 ${!p.activo ? 'opacity-50' : ''}`}
                  onClick={() => navigate(`/expediente/${p.id}`)}
                >
                  <td>
                    <p className="font-medium">
                      {p.nombre} {p.apellido_paterno} {p.apellido_materno}
                    </p>
                  </td>
                  <td className="text-sm text-gray-600">{p.cliente_nombre}</td>
                  <td className="text-center">{edad(p.fecha_nacimiento) ?? '—'}</td>
                  <td className="font-mono text-xs">{p.curp || '—'}</td>
                  <td className="text-sm text-gray-600">{p.telefono || p.email || '—'}</td>
                  <td className="text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.activo ? 'Activo' : 'Inactivo'}
                    </span>
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
        <Modal title="Nuevo paciente" onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit((d) => crearMut.mutate(d))} className="space-y-4">
            <div>
              <label className="label">Cliente (hospital/clínica) *</label>
              <select className="input" {...register('cliente_id', { required: 'Requerido' })}>
                <option value="">Selecciona…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.razon_social}</option>
                ))}
              </select>
              {errors.cliente_id && <p className="text-xs text-red-500 mt-1">{errors.cliente_id.message}</p>}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-3 md:col-span-1">
                <label className="label">Nombre(s) *</label>
                <input className="input" {...register('nombre', { required: 'Requerido' })} />
                {errors.nombre && <p className="text-xs text-red-500 mt-1">{errors.nombre.message}</p>}
              </div>
              <div>
                <label className="label">Apellido paterno</label>
                <input className="input" {...register('apellido_paterno')} />
              </div>
              <div>
                <label className="label">Apellido materno</label>
                <input className="input" {...register('apellido_materno')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Fecha de nacimiento</label>
                <input type="date" className="input" {...register('fecha_nacimiento')} />
              </div>
              <div>
                <label className="label">Sexo</label>
                <select className="input" {...register('sexo')}>
                  {SEXOS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">CURP</label>
                <input className="input uppercase" maxLength={18} {...register('curp')} />
              </div>
              <div>
                <label className="label">Tipo de sangre</label>
                <input className="input" placeholder="O+" {...register('tipo_sangre')} />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input className="input" {...register('telefono')} />
              </div>
              <div>
                <label className="label">Email</label>
                <input type="email" className="input" {...register('email')} />
              </div>
            </div>
            <div>
              <label className="label">Alergias</label>
              <textarea className="input min-h-[50px]" placeholder="Ninguna conocida" {...register('alergias')} />
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4">
              <div>
                <label className="label">Contacto de emergencia</label>
                <input className="input" {...register('contacto_emergencia_nombre')} />
              </div>
              <div>
                <label className="label">Teléfono de emergencia</label>
                <input className="input" {...register('contacto_emergencia_telefono')} />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={crearMut.isPending} className="btn-primary">
                {crearMut.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
                Crear paciente
              </button>
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
