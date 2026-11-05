import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  CalendarRange,
  ClipboardList,
  CreditCard,
  FileText,
  FolderTree,
  Handshake,
  Languages,
  LayoutDashboard,
  ListChecks,
  Mail,
  Map,
  MessageSquare,
  Receipt,
  ScanLine,
  TicketPercent,
  UserRound,
  Users,
} from 'lucide-react';

export const ADMIN_SECTIONS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/usuarios', label: 'Usuarios', icon: Users },
  { to: '/admin/catalogo', label: 'Catálogo', icon: Map },
  { to: '/admin/incluye', label: 'Qué incluye', icon: ListChecks },
  { to: '/admin/categorias', label: 'Categorías', icon: FolderTree },
  { to: '/admin/idiomas', label: 'Idiomas', icon: Languages },
  { to: '/admin/guias', label: 'Guías y operadores', icon: UserRound },
  { to: '/admin/disponibilidad', label: 'Disponibilidad', icon: CalendarRange },
  { to: '/admin/reservas', label: 'Reservas', icon: ClipboardList },
  { to: '/admin/checkin', label: 'Check-in', icon: ScanLine },
  { to: '/admin/pedidos', label: 'Pedidos', icon: Receipt },
  { to: '/admin/pagos', label: 'Pagos', icon: CreditCard },
  { to: '/admin/facturas', label: 'Facturas', icon: FileText },
  { to: '/admin/cupones', label: 'Cupones', icon: TicketPercent },
  { to: '/admin/resenas', label: 'Reseñas', icon: MessageSquare },
  { to: '/admin/mensajes', label: 'Mensajes', icon: Mail },
  { to: '/admin/socios', label: 'Socios', icon: Handshake },
  { to: '/admin/reportes', label: 'Reportes', icon: BarChart3 },
  { to: '/admin/observabilidad', label: 'Observabilidad', icon: Activity },
];

/** Layout del área administrativa. La ocultación en el frontend no sustituye la autorización del servidor. */
export default function AdminLayout() {
  return (
    <div className="page-container pt-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand-500">Administración</p>
      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Administración">
          <ul className="scrollbar-none flex gap-1 overflow-x-auto lg:flex-col">
            {ADMIN_SECTIONS.map(({ to, label, icon: Icon, end }) => (
              <li key={to} className="shrink-0">
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-semibold ${isActive ? 'bg-brand-50 text-brand-600' : 'hover:bg-surface'}`
                  }
                >
                  <Icon size={17} aria-hidden="true" /> {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
