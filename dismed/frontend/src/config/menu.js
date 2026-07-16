import {
  LayoutDashboard, ClipboardList, Users, Truck, Package, FileText, UserCog,
  Layers, Warehouse, Boxes, ArrowLeftRight, ShoppingCart, BookOpen, History,
  HelpCircle, Receipt, SlidersHorizontal, Settings, Download, Upload, Wrench,
  Calculator, TrendingUp, Scale, BookOpenCheck, ListTree, Landmark, BookText,
  FileSpreadsheet, BarChart3, Store, Clock, Pill, Building2, FileUp,
} from 'lucide-react';

// Catálogo canónico del menú. Debe mantenerse en sincronía con el backend
// (src/modules/usuarios/menu.keys.js) en cuanto a las claves operables.
//
// Flags por item:
//   always: true     → visible para todos sin permiso (no se configura).
//   adminOnly: true  → solo admin (nunca se otorga a operadores).
//   (sin flag)       → "operable": requiere permiso para operadores; admin siempre.
export const MENU = {
  top: [
    { key: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ],
  groups: [
    {
      label: 'Ventas', icon: ShoppingCart, items: [
        { key: 'clientes',     to: '/clientes',       label: 'Clientes',          icon: Users },
        { key: 'solicitudes',  to: '/solicitudes',    label: 'Solicitudes',       icon: ClipboardList },
        { key: 'cotizaciones', to: '/cotizaciones',   label: 'Cotizaciones',      icon: FileText },
        { key: 'pedidos',      to: '/ventas/pedidos', label: 'Pedidos / Surtido', icon: ShoppingCart },
      ],
    },
    {
      label: 'Inventario', icon: Package, items: [
        { key: 'existencias',        to: '/inventario/existencias', label: 'Existencias',           icon: Boxes },
        { key: 'movimientos',        to: '/inventario/movimientos', label: 'Movimientos',           icon: ArrowLeftRight },
        { key: 'carga-facturas',     to: '/inventario/carga-facturas', label: 'Carga automática de facturas', icon: FileUp },
        { key: 'almacenes',          to: '/inventario/almacenes',   label: 'Almacenes',             icon: Warehouse },
        { key: 'productos',          to: '/productos',              label: 'Catálogo de productos', icon: Package },
        { key: 'proveedores',        to: '/proveedores',            label: 'Proveedores',           icon: Truck },
        { key: 'catalogo-proveedor', to: '/catalogo-proveedores',   label: 'Catálogo por proveedor', icon: BookOpen },
        { key: 'catalogos-apoyo',    to: '/inventario/catalogos',   label: 'Catálogos de apoyo',    icon: Layers },
      ],
    },
    {
      label: 'Consultas', icon: History, items: [
        { key: 'consultas',     to: '/consultas',      label: 'Consultas históricas', icon: History },
        { key: 'cfdi',          to: '/cfdi',           label: 'CFDI del SAT',         icon: Receipt },
        { key: 'descargas-sat', to: '/cfdi/descargas', label: 'Descargas SAT',        icon: Download, adminOnly: true },
      ],
    },
    {
      label: 'Contabilidad', icon: Calculator, items: [
        { key: 'contabilidad-estado-resultados', to: '/contabilidad/estado-resultados', label: 'Estado de resultados',    icon: TrendingUp },
        { key: 'contabilidad-balance-general',   to: '/contabilidad/balance-general',   label: 'Balance general',         icon: Scale },
        { key: 'contabilidad-balanza',           to: '/contabilidad/balanza',           label: 'Balanza de comprobación', icon: BookOpenCheck },
        { key: 'contabilidad-catalogo-cuentas',  to: '/contabilidad/catalogo-cuentas',  label: 'Catálogo de cuentas',     icon: ListTree },
        { key: 'contabilidad-polizas',                  to: '/contabilidad/polizas',                  label: 'Pólizas',                    icon: BookText },
        { key: 'contabilidad-bancos',                  to: '/contabilidad/bancos',                  label: 'Bancos',                     icon: Landmark },
        { key: 'contabilidad-cfdi-por-comprobante',    to: '/contabilidad/cfdi-por-comprobante',    label: 'CFDI por comprobante',        icon: FileSpreadsheet },
        { key: 'contabilidad-cfdi-resumen-general',    to: '/contabilidad/cfdi-resumen-general',    label: 'CFDI resumen general',        icon: BarChart3 },
      ],
    },
    {
      label: 'POS Farmacia', icon: Store, items: [
        { key: 'pos-venta',    to: '/pos',            label: 'Venta mostrador',      icon: Store },
        { key: 'pos-turnos',   to: '/pos/turnos',     label: 'Caja y turnos',        icon: Clock },
        { key: 'pos-bitacora', to: '/pos/bitacora',   label: 'Bitácora COFEPRIS',    icon: Pill },
        { key: 'pos-admin',    to: '/pos/sucursales', label: 'Sucursales y cajas',   icon: Warehouse },
      ],
    },
    {
      label: 'Herramientas', icon: Wrench, items: [
        { key: 'herramientas-importar', to: '/herramientas/importar', label: 'Importar datos', icon: Upload },
        { key: 'herramientas-exportar', to: '/herramientas/exportar', label: 'Exportar datos', icon: Download },
      ],
    },
    {
      label: 'Configuración', icon: Settings, items: [
        { key: 'preferencias', to: '/configuracion', label: 'Preferencias', icon: SlidersHorizontal, always: true },
        { key: 'usuarios',     to: '/usuarios',      label: 'Usuarios',     icon: UserCog, adminOnly: true },
        { key: 'empresas',     to: '/configuracion/empresas', label: 'Empresas', icon: Building2, adminOnly: true },
      ],
    },
  ],
  bottom: [
    { key: 'ayuda', to: '/ayuda', label: 'Ayuda', icon: HelpCircle, always: true },
  ],
};

// Todos los items en una sola lista plana.
export const ALL_ITEMS = [
  ...MENU.top,
  ...MENU.groups.flatMap((g) => g.items),
  ...MENU.bottom,
];

// Items operables (los que el admin otorga/quita a operadores).
export const PERMISSIONABLE_ITEMS = ALL_ITEMS.filter((i) => !i.always && !i.adminOnly);

// Grupos para la UI de permisos en Configuración (solo items operables).
export const PERMISSION_GROUPS = [
  { label: 'General', items: MENU.top.filter((i) => !i.always && !i.adminOnly) },
  ...MENU.groups.map((g) => ({ label: g.label, items: g.items.filter((i) => !i.always && !i.adminOnly) })),
].filter((g) => g.items.length);

// Item de menú correspondiente a una ruta (match por prefijo más largo, para
// que /cfdi/descargas gane sobre /cfdi y las subrutas hereden su item base).
export function itemForPath(pathname) {
  let best = null;
  for (const it of ALL_ITEMS) {
    if (pathname === it.to || pathname.startsWith(it.to + '/')) {
      if (!best || it.to.length > best.to.length) best = it;
    }
  }
  return best;
}
