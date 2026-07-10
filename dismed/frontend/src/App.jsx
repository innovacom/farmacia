import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SolicitudesList from './pages/Solicitudes/SolicitudesList';
import NuevaSolicitud from './pages/Solicitudes/NuevaSolicitud';
import DetalleSolicitud from './pages/Solicitudes/DetalleSolicitud';
import ComparadorPrecios from './pages/Proveedores/ComparadorPrecios';
import RegistrarPrecios from './pages/Proveedores/RegistrarPrecios';
import CotizacionesList from './pages/Cotizaciones/CotizacionesList';
import NuevaCotizacion from './pages/Cotizaciones/NuevaCotizacion';
import DetalleCotizacion from './pages/Cotizaciones/DetalleCotizacion';
import ClientesList from './pages/Clientes/ClientesList';
import ProveedoresList from './pages/Proveedores/ProveedoresList';
import CatalogoProveedor from './pages/Proveedores/CatalogoProveedor';
import ProductosList from './pages/Productos/ProductosList';
import CatalogosApoyo from './pages/Inventario/CatalogosApoyo';
import Almacenes from './pages/Inventario/Almacenes';
import Existencias from './pages/Inventario/Existencias';
import Movimientos from './pages/Inventario/Movimientos';
import PedidosList from './pages/Ventas/PedidosList';
import CrearPedido from './pages/Ventas/CrearPedido';
import DetallePedido from './pages/Ventas/DetallePedido';
import UsuariosList from './pages/Usuarios/UsuariosList';
import ConsultasHistoricas from './pages/Consultas/ConsultasHistoricas';
import ConsultaCfdi from './pages/Cfdi/ConsultaCfdi';
import DescargasSat from './pages/Cfdi/DescargasSat';
import EstadoResultados from './pages/Contabilidad/EstadoResultados';
import BalanceGeneral from './pages/Contabilidad/BalanceGeneral';
import BalanzaComprobacion from './pages/Contabilidad/BalanzaComprobacion';
import CatalogoCuentas from './pages/Contabilidad/CatalogoCuentas';
import Polizas from './pages/Contabilidad/Polizas';
import Bancos from './pages/Contabilidad/Bancos';
import CfdiPorComprobante from './pages/Contabilidad/CfdiPorComprobante';
import CfdiResumenGeneral from './pages/Contabilidad/CfdiResumenGeneral';
import Configuracion from './pages/Configuracion/Configuracion';
import ImportarDatos from './pages/Herramientas/ImportarDatos';
import ExportarDatos from './pages/Herramientas/ExportarDatos';
import Ayuda from './pages/Ayuda/Ayuda';

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"                           element={<Dashboard />} />
        <Route path="solicitudes"                         element={<SolicitudesList />} />
        <Route path="solicitudes/nueva"                   element={<NuevaSolicitud />} />
        <Route path="solicitudes/:id"                     element={<DetalleSolicitud />} />
        <Route path="solicitudes/:id/comparador"          element={<ComparadorPrecios />} />
        <Route path="solicitudes/:id/proveedores/:cpId"   element={<RegistrarPrecios />} />
        <Route path="cotizaciones"                        element={<CotizacionesList />} />
        <Route path="cotizaciones/nueva/:solicitudId"     element={<NuevaCotizacion />} />
        <Route path="cotizaciones/:id"                    element={<DetalleCotizacion />} />
        <Route path="clientes"                            element={<ClientesList />} />
        <Route path="proveedores"                         element={<ProveedoresList />} />
        <Route path="catalogo-proveedores"                element={<CatalogoProveedor />} />
        <Route path="productos"                           element={<ProductosList />} />
        <Route path="inventario/catalogos"                element={<CatalogosApoyo />} />
        <Route path="inventario/almacenes"                element={<Almacenes />} />
        <Route path="inventario/existencias"              element={<Existencias />} />
        <Route path="inventario/movimientos"              element={<Movimientos />} />
        <Route path="ventas/pedidos"                       element={<PedidosList />} />
        <Route path="ventas/pedidos/nuevo/:cotizacionId"   element={<CrearPedido />} />
        <Route path="ventas/pedidos/:id"                   element={<DetallePedido />} />
        <Route path="usuarios"                            element={<UsuariosList />} />
        <Route path="consultas"                           element={<ConsultasHistoricas />} />
        <Route path="cfdi"                                element={<ConsultaCfdi />} />
        <Route path="cfdi/descargas"                      element={<DescargasSat />} />
        <Route path="contabilidad/estado-resultados"      element={<EstadoResultados />} />
        <Route path="contabilidad/balance-general"        element={<BalanceGeneral />} />
        <Route path="contabilidad/balanza"                element={<BalanzaComprobacion />} />
        <Route path="contabilidad/catalogo-cuentas"       element={<CatalogoCuentas />} />
        <Route path="contabilidad/polizas"                element={<Polizas />} />
        <Route path="contabilidad/bancos"                 element={<Bancos />} />
        <Route path="contabilidad/cfdi-por-comprobante"  element={<CfdiPorComprobante />} />
        <Route path="contabilidad/cfdi-resumen-general"  element={<CfdiResumenGeneral />} />
        <Route path="configuracion"                       element={<Configuracion />} />
        <Route path="herramientas/importar"               element={<ImportarDatos />} />
        <Route path="herramientas/exportar"               element={<ExportarDatos />} />
        <Route path="ayuda"                               element={<Ayuda />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
