import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ClipboardList, FileText, AlertTriangle, TrendingUp, Plus } from 'lucide-react';
import api from '../services/api';

function StatCard({ label, value, icon: Icon, color, to }) {
  const content = (
    <div className={`card flex items-center gap-4 hover:shadow-md transition-shadow
                     ${to ? 'cursor-pointer' : ''}`}>
      <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center shrink-0`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

export default function Dashboard() {
  const { data: solicitudes = [] } = useQuery({
    queryKey: ['solicitudes'],
    queryFn: () => api.get('/solicitudes').then((r) => r.data),
  });

  const { data: cotizaciones = [] } = useQuery({
    queryKey: ['cotizaciones'],
    queryFn: () => api.get('/cotizaciones-cliente').then((r) => r.data),
  });

  const activas    = solicitudes.filter((s) => ['nueva','cotizando'].includes(s.estatus)).length;
  const enviadas   = cotizaciones.filter((c) => c.estatus === 'enviada').length;
  const aceptadas  = cotizaciones.filter((c) => c.estatus === 'aceptada').length;
  const recientes  = solicitudes.slice(0, 5);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Resumen de operaciones</p>
        </div>
        <Link to="/solicitudes/nueva" className="btn-primary">
          <Plus size={16} />
          Nueva solicitud
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Solicitudes activas"
          value={activas}
          icon={ClipboardList}
          color="bg-blue-500"
          to="/solicitudes"
        />
        <StatCard
          label="Cotizaciones enviadas"
          value={enviadas}
          icon={FileText}
          color="bg-purple-500"
          to="/cotizaciones"
        />
        <StatCard
          label="Pedidos aceptados"
          value={aceptadas}
          icon={TrendingUp}
          color="bg-green-500"
        />
        <StatCard
          label="Total solicitudes"
          value={solicitudes.length}
          icon={AlertTriangle}
          color="bg-orange-500"
        />
      </div>

      {/* Solicitudes recientes */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Solicitudes recientes</h2>
          <Link to="/solicitudes" className="text-sm text-brand-500 hover:underline">
            Ver todas
          </Link>
        </div>
        {recientes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No hay solicitudes aún.{' '}
            <Link to="/solicitudes/nueva" className="text-brand-500 hover:underline">
              Crear la primera
            </Link>
          </p>
        ) : (
          <table className="table-auto w-full">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Partidas</th>
                <th>Estatus</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recientes.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-xs font-medium text-brand-500">{s.folio}</td>
                  <td>{s.cliente}</td>
                  <td>
                    <span className="badge-gray capitalize">{s.tipo_origen}</span>
                  </td>
                  <td className="text-center">{s.num_partidas}</td>
                  <td><EstatusBadge estatus={s.estatus} /></td>
                  <td>
                    <Link to={`/solicitudes/${s.id}`} className="text-xs text-brand-500 hover:underline">
                      Ver
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EstatusBadge({ estatus }) {
  const map = {
    nueva:     'badge-blue',
    cotizando: 'badge-yellow',
    cotizada:  'badge-green',
    pedido:    'badge-green',
    cancelada: 'badge-red',
  };
  return <span className={map[estatus] || 'badge-gray'}>{estatus}</span>;
}
