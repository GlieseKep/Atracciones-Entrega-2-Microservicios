import { lazy } from 'react';
import { createBrowserRouter, Navigate, useLocation, useParams } from 'react-router-dom';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import HomePage from '@/pages/HomePage';
import { AppLayout } from './AppLayout';
import { ROUTES } from './routes';

// Carga diferida por página.
const AttractionsPage = lazy(() => import('@/pages/AttractionsPage'));
const AttractionDetailPage = lazy(() => import('@/pages/AttractionDetailPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const CheckoutPage = lazy(() => import('@/pages/CheckoutPage'));
const ReservationDetailPage = lazy(() => import('@/pages/ReservationDetailPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const HelpPage = lazy(() => import('@/pages/HelpPage'));
const LoginPage = lazy(() => import('@/pages/AuthPages').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/pages/AuthPages').then((m) => ({ default: m.RegisterPage })));
const RecoverPage = lazy(() => import('@/pages/AuthPages').then((m) => ({ default: m.RecoverPage })));
const ResetPasswordPage = lazy(() => import('@/pages/AuthPages').then((m) => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import('@/pages/AuthPages').then((m) => ({ default: m.VerifyEmailPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'));
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'));
const AdminCatalogPage = lazy(() => import('@/pages/admin/AdminCatalogPage'));
const AdminAvailabilityPage = lazy(() => import('@/pages/admin/AdminAvailabilityPage'));
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage'));
const AdminGuidesPage = lazy(() => import('@/pages/admin/AdminGuidesPage'));
const AdminReviewsPage = lazy(() => import('@/pages/admin/AdminModulesPages').then((m) => ({ default: m.AdminReviewsPage })));
const AdminCouponsPage = lazy(() => import('@/pages/admin/AdminModulesPages').then((m) => ({ default: m.AdminCouponsPage })));
const AdminMessagesPage = lazy(() => import('@/pages/admin/AdminModulesPages').then((m) => ({ default: m.AdminMessagesPage })));
const AdminInvoicesPage = lazy(() => import('@/pages/admin/AdminModulesPages').then((m) => ({ default: m.AdminInvoicesPage })));
const AdminPartnersPage = lazy(() => import('@/pages/admin/AdminModulesPages').then((m) => ({ default: m.AdminPartnersPage })));
const AdminReportsPage = lazy(() => import('@/pages/admin/AdminReportsPage'));
const AdminObservabilityPage = lazy(() => import('@/pages/admin/AdminObservabilityPage'));
const AdminReservationsPage = lazy(() => import('@/pages/admin/AdminOperationsPages').then((m) => ({ default: m.AdminReservationsPage })));
const AdminOrdersPage = lazy(() => import('@/pages/admin/AdminOrdersPage'));
const AdminCheckinPage = lazy(() => import('@/pages/admin/AdminCheckinPage'));
const AdminPaymentsPage = lazy(() => import('@/pages/admin/AdminOperationsPages').then((m) => ({ default: m.AdminPaymentsPage })));

const privateRoute = (element: React.ReactNode) => <ProtectedRoute>{element}</ProtectedRoute>;

/** `/atracciones/:id/reservar` ("reservar sin pagar" del portal anterior) ya no existe: la compra es un solo paso. */
function LegacyReserveRedirect() {
  const { id = '' } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/atracciones/${id}/comprar${search}`} replace />;
}

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
      { path: ROUTES.recover, element: <RecoverPage /> },
      { path: ROUTES.resetPassword, element: <ResetPasswordPage /> },
      { path: ROUTES.verifyEmail, element: <VerifyEmailPage /> },
      { path: ROUTES.legacyReserve, element: <LegacyReserveRedirect /> },
      { path: ROUTES.checkout, element: privateRoute(<CheckoutPage />) },
      { path: ROUTES.reservation, element: privateRoute(<ReservationDetailPage />) },
      { path: ROUTES.profile, element: privateRoute(<ProfilePage />) },
      // Fuera del bloque /admin (que exige ADMIN): también la usan el guía (GUIA) y el operador. La página valida el rol.
      { path: ROUTES.adminCheckin, element: privateRoute(<AdminCheckinPage />) },
      {
        path: ROUTES.admin,
        element: (
          <ProtectedRoute role="ADMIN">
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
          { path: 'usuarios', element: <AdminUsersPage /> },
          { path: 'guias', element: <AdminGuidesPage /> },
          { path: 'facturas', element: <AdminInvoicesPage /> },
          { path: 'cupones', element: <AdminCouponsPage /> },
          { path: 'resenas', element: <AdminReviewsPage /> },
          { path: 'mensajes', element: <AdminMessagesPage /> },
          { path: 'socios', element: <AdminPartnersPage /> },
          { path: 'reportes', element: <AdminReportsPage /> },
          { path: 'observabilidad', element: <AdminObservabilityPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
