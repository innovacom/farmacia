import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LogOut, X, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { usePermisos } from '../../hooks/usePermisos';
import { useBranding } from '../../hooks/useBranding';
import { MENU } from '../../config/menu';

const itemClass = ({ isActive }) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
   ${isActive
     ? 'bg-brand-50 text-brand-500'
     : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`;

const subItemClass = ({ isActive }) =>
  `flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm transition-colors
   ${isActive
     ? 'bg-brand-50 text-brand-500 font-medium'
     : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`;

function groupHasActive(items, pathname) {
  return items.some((it) => pathname === it.to || pathname.startsWith(it.to + '/'));
}

export default function Sidebar({ open = false, onClose = () => {} }) {
  const { user, logout } = useAuthStore();
  const { pathname } = useLocation();
  const { can, ready } = usePermisos();
  const branding = useBranding();

  // Items visibles para este usuario (admin ve todo; operador según permisos).
  const visibleGroups = MENU.groups
    .map((g) => ({ ...g, items: g.items.filter(can) }))
    .filter((g) => g.items.length > 0);
  const visibleTop = MENU.top.filter(can);
  const visibleBottom = MENU.bottom.filter(can);

  // Cada grupo arranca abierto si la ruta activa está dentro de él.
  const [openGroups, setOpenGroups] = useState(() => {
    const init = {};
    MENU.groups.forEach((g) => { init[g.label] = groupHasActive(g.items, pathname); });
    return init;
  });

  const toggle = (label) => setOpenGroups((s) => ({ ...s, [label]: !s[label] }));

  function handleLogout() {
    logout();
    // window.location fuerza recarga completa — limpia React Query cache y todo el estado en memoria
    window.location.replace('/login');
  }

  return (
    <>
      {/* Fondo oscuro al abrir el menú en móvil */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={onClose} />
      )}

      <aside
        className={`w-60 bg-white border-r border-gray-200 flex flex-col shrink-0
                    fixed inset-y-0 left-0 z-40 transform transition-transform duration-200
                    md:static md:translate-x-0 md:z-auto
                    ${open ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <img
              src={branding?.logo_url || '/logo_innovacom.png'}
              alt={branding?.nombre_comercial || 'INNOVACOM'}
              className="w-10 h-10 object-contain"
            />
            <div className="flex-1">
              <p className="font-bold text-gray-900 text-sm leading-none">
                {branding?.nombre_comercial || 'INNOVACOM'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">ERP Distribución Médica</p>
            </div>
            <button
              onClick={onClose}
              className="md:hidden p-1.5 text-gray-400 hover:text-gray-700 rounded-lg"
              aria-label="Cerrar menú"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Navegación */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {!ready ? (
            <p className="text-xs text-gray-400 px-3 py-2">Cargando menú…</p>
          ) : (
            <>
              {visibleTop.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} onClick={onClose} className={itemClass}>
                  <Icon size={17} />
                  {label}
                </NavLink>
              ))}

              {visibleGroups.map((group) => {
                const isOpen = openGroups[group.label];
                const GroupIcon = group.icon;
                return (
                  <div key={group.label} className="pt-1">
                    <button
                      onClick={() => toggle(group.label)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold
                                 text-gray-700 hover:bg-gray-50 transition-colors"
                      aria-expanded={isOpen}
                    >
                      <GroupIcon size={17} />
                      <span className="flex-1 text-left">{group.label}</span>
                      <ChevronDown
                        size={15}
                        className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isOpen && (
                      <div className="mt-0.5 space-y-0.5">
                        {group.items.map(({ to, label, icon: Icon }) => (
                          <NavLink key={to} to={to} onClick={onClose} className={subItemClass}>
                            <Icon size={16} />
                            {label}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {visibleBottom.length > 0 && (
                <div className="pt-3 pb-1 px-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Soporte</p>
                </div>
              )}
              {visibleBottom.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} onClick={onClose} className={itemClass}>
                  <Icon size={17} />
                  {label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Usuario */}
        <div className="px-3 py-4 border-t border-gray-100">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 mb-2">
            <div className="w-7 h-7 bg-brand-500 rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-bold">
                {user?.nombre?.[0]?.toUpperCase() || 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 truncate">{user?.nombre}</p>
              <p className="text-xs text-gray-400 truncate">{user?.rol}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500
                       hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut size={15} />
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  );
}
