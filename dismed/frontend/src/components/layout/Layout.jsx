import { useState } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { Menu, Lock } from 'lucide-react';
import Sidebar from './Sidebar';
import { usePermisos } from '../../hooks/usePermisos';
import { itemForPath } from '../../config/menu';

// Bloquea el contenido si el usuario no tiene permiso para la ruta actual
// (acceso por URL directa). El menú ya oculta lo no permitido; esto refuerza.
function GuardedOutlet() {
  const { pathname } = useLocation();
  const { can, ready } = usePermisos();

  if (!ready) {
    return <p className="text-sm text-gray-400 text-center py-16">Cargando…</p>;
  }
  if (!can(itemForPath(pathname))) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <Lock size={40} className="mx-auto text-gray-300 mb-3" />
        <h2 className="text-lg font-semibold text-gray-800">Sin acceso</h2>
        <p className="text-sm text-gray-500 mt-1">
          No tienes permiso para esta sección. Pide a un administrador que te lo otorgue.
        </p>
        <Link to="/dashboard" className="btn-secondary inline-flex mt-4">Ir al inicio</Link>
      </div>
    );
  }
  return <Outlet />;
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Barra superior solo en móvil */}
        <header className="md:hidden flex items-center gap-3 bg-white border-b border-gray-200 px-4 h-14 shrink-0"
                style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            aria-label="Abrir menú"
          >
            <Menu size={22} />
          </button>
          <img src="/logo_innovacom.png" alt="" className="w-7 h-7 object-contain" />
          <p className="font-bold text-gray-900 text-sm">INNOVACOM</p>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
            <GuardedOutlet />
          </div>
        </main>
      </div>
    </div>
  );
}
