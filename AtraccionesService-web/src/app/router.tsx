import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { ADMIN_SCOPE } from '@/api/admin';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import HomePage from '@/pages/HomePage';
import { AppLayout } from './AppLayout';
import { ROUTES } from './routes';

// Carga diferida por página (plan §18, fase 8).
const AttractionsPage = lazy(() => import('@/pages/AttractionsPage'));
const AttractionDetailPage = lazy(() => import('@/pages/AttractionDetailPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const ReservationPage = lazy(() => import('@/pages/ReservationPage'));
const ReservationDetailPage = lazy(() => import('@/pages/ReservationDetailPage'));
const PurchasePage = lazy(() => import('@/pages/PurchasePage'));
const OrderPage = lazy(() => import('@/pages/OrderPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const HelpPage = lazy(() => import('@/pages/HelpPage'));
const LoginPage = lazy(() => import('@/pages/AuthPages').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/pages/AuthPages').then((m) => ({ default: m.RegisterPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'));
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'));
const AdminCatalogPage = lazy(() => import('@/pages/admin/AdminCatalogPage'));
const AdminAvailabilityPage = lazy(() => import('@/pages/admin/AdminAvailabilityPage'));
const AdminCustomersPage = lazy(() => import('@/pages/admin/AdminCustomersPage'));
const AdminReportsPage = lazy(() => import('@/pages/admin/AdminReportsPage'));
const AdminObservabilityPage = lazy(() => import('@/pages/admin/AdminObservabilityPage'));
const AdminReservationsPage = lazy(() => import('@/pages/admin/AdminOperationsPages').then((m) => ({ default: m.AdminReservationsPage })));
const AdminOrdersPage = lazy(() => import('@/pages/admin/AdminOrdersPage'));
const AdminPaymentsPage = lazy(() => import('@/pages/admin/AdminOperationsPages').then((m) => ({ default: m.AdminPaymentsPage })));

const privateRoute = (element: React.ReactNode) => <ProtectedRoute>{element}</ProtectedRoute>;

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: ROUTES.home, element: <HomePage /> },
      { path: ROUTES.attractions, element: <AttractionsPage /> },
      { path: ROUTES.attractionDetail, element: <AttractionDetailPage /> },
      { path: ROUTES.search, element: <SearchPage /> },
      { path: ROUTES.help, element: <HelpPage /> },
      { path: ROUTES.login, element: <LoginPage /> },
      { path: ROUTES.register, element: <RegisterPage /> },
      { path: ROUTES.reserve, element: privateRoute(<ReservationPage />) },
      { path: ROUTES.purchase, element: privateRoute(<PurchasePage />) },
      { path: ROUTES.reservation, element: privateRoute(<ReservationDetailPage />) },
      { path: ROUTES.order, element: privateRoute(<OrderPage />) },
      { path: ROUTES.profile, element: privateRoute(<ProfilePage />) },
      {
        path: ROUTES.admin,
        element: (
          <ProtectedRoute scope={ADMIN_SCOPE}>
            <AdminLayout />
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: <AdminDashboardPage /> },
          { path: 'catalogo', element: <AdminCatalogPage /> },
          { path: 'disponibilidad', element: <AdminAvailabilityPage /> },
          { path: 'reservas', element: <AdminReservationsPage /> },
          { path: 'pedidos', element: <AdminOrdersPage /> },
          { path: 'pagos', element: <AdminPaymentsPage /> },
          { path: 'clientes', element: <AdminCustomersPage key="clientes" /> },
          { path: 'usuarios', element: <AdminCustomersPage key="usuarios" manageRoles /> },
          { path: 'reportes', element: <AdminReportsPage /> },
          { path: 'observabilidad', element: <AdminObservabilityPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
