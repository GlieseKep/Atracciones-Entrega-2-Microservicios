import { authPost } from '@/features/auth/session';
import type {
  AdminAttraction,
  AdminPage,
  AdminReview,
  Agreement,
  ApiClient,
  AttractionRequest,
  AttractionState,
  AuditEntry,
  BlockedDate,
  ContactMessage,
  Coupon,
  CreatedApiClient,
  Guide,
  Inclusion,
  MetadataPage,
  Operator,
  PaginationPage,
  Payment,
  PaymentState,
  PriceTable,
  Refund,
  RoleInfo,
  Schedule,
  Slot,
  SlotsGuideResult,
  SystemHealth,
} from '@/types/admin';
import type { Category } from '@/types/attraction';
import type { Reservation, ReservationPage, ReservationStatus } from '@/types/booking';
import type { RoleName, User } from '@/types/identity';
import type { Invoice, OrderState, OrderSummary } from '@/types/order';
import type { PaymentMethodCode } from '@/types/booking';
import { gql } from './client';

/**
 * Operaciones del panel administrativo por GraphQL (`apps/graphql/src/operations.ts`). Cada función devuelve la
 * respuesta del servicio; los listados se normalizan a `{ total, items }` para `AdminTable`.
 * Ver `Plan/AUDITORIA_PANEL_ADMIN.md`.
 */

type Signal = AbortSignal | undefined;

const fromMetadata = <T>(page: MetadataPage<T>): AdminPage<T> => ({ total: page.metadata.total_results, items: page.data });
const fromPagination = <T>(page: PaginationPage<T>): AdminPage<T> => ({ total: page.pagination.total_results, items: page.data });
/** Quita los filtros vacíos para no mandar `""` a los servicios. */
const clean = (input: object) => Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export interface PageParams {
  page: number;
  limit: number;
}

// Identity: usuarios, roles y socios ---------------------------------------------

export const usersApi = {
  list: (p: PageParams & { q?: string; rol?: RoleName | ''; activo?: '' | 'true' | 'false' }, signal?: Signal) =>
    gql.query<MetadataPage<User>>('identityListUsers', clean(p), { signal }).then(fromMetadata),
  get: (id: number, signal?: Signal) => gql.query<User>('identityGetUser', { id }, { signal }),
  roles: (signal?: Signal) => gql.query<RoleInfo[]>('identityListRoles', {}, { signal }),
  setActive: (id: number, activo: boolean) => gql.mutation<User>('identitySetUserActive', { id, activo }),
  assignRole: (id: number, rol: RoleName) => gql.mutation<User>('identityAssignRole', { id, rol }),
  removeRole: (id: number, rol: RoleName) => gql.mutation<User>('identityRemoveRole', { id, rol }),
  /**
   * Alta desde el panel (opción A de la auditoría §4.3): registro público con contraseña temporal. Registrar no abre
   * sesión, así que no toca la del administrador. Los roles se asignan después con `assignRole`.
   */
  create: (body: { correo: string; password: string; nombre: string; apellido: string; telefono?: string | null }) =>
    authPost<User>('/auth/registro', body),
};

export const apiClientsApi = {
  list: (signal?: Signal) => gql.query<ApiClient[]>('identityListApiClients', {}, { signal }),
  create: (codigo: string, nombre: string) => gql.mutation<CreatedApiClient>('identityCreateApiClient', { codigo, nombre }),
  setActive: (id: number, activo: boolean) => gql.mutation<ApiClient>('identitySetApiClientActive', { id, activo }),
};

// Catalog ------------------------------------------------------------------------

export const catalogApi = {
  list: (p: PageParams & { q?: string; estado?: AttractionState | ''; operador?: string }, signal?: Signal) =>
    gql.query<MetadataPage<AdminAttraction>>('catalogAdminListAttractions', clean(p), { signal }).then(fromMetadata),
  get: (id: string, signal?: Signal) => gql.query<AdminAttraction>('catalogAdminGetAttraction', { id }, { signal }),
  create: (body: AttractionRequest) => gql.mutation<AdminAttraction>('catalogAdminCreateAttraction', body),
  update: (id: string, body: AttractionRequest) => gql.mutation<AdminAttraction>('catalogAdminUpdateAttraction', { id, ...body }),
  remove: (id: string) => gql.mutation<void>('catalogAdminDeleteAttraction', { id }),
  setState: (id: string, estado: AttractionState) => gql.mutation<AdminAttraction>('catalogAdminSetAttractionState', { id, estado }),
  /** Todas las categorías, también las subcategorías: una atracción puede estar en cualquiera. */
  categories: async (signal?: Signal): Promise<Category[]> => {
    type Node = Category & { subcategorias?: Node[] };
    const flatten = (nodes: Node[], prefix = ''): Category[] =>
      nodes.flatMap((n) => [{ ...n, nombre: `${prefix}${n.nombre}` }, ...flatten(n.subcategorias ?? [], `${prefix}${n.nombre} › `)]);
    return flatten(await gql.query<Node[]>('catalogGetCategoryTree', {}, { signal }));
  },
  createCategory: (body: { id: string; padre_id?: string; nombre: string; slug: string; descripcion?: string; orden?: number }) =>
    gql.mutation<Category>('catalogCreateCategory', body),
  languages: (signal?: Signal) => gql.query<{ codigo: string; nombre: string }[]>('catalogListLanguages', {}, { signal }),
  inclusions: (signal?: Signal) => gql.query<Inclusion[]>('catalogListInclusions', {}, { signal }),
  operators: (signal?: Signal) => gql.query<Operator[]>('catalogListOperators', {}, { signal }),
  createOperator: (body: { id: string; nombre_comercial: string; ruc?: string; email_soporte?: string; telefono_emergencia?: string; direccion?: string; prov_id: number }) =>
    gql.mutation<Operator>('catalogCreateOperator', body),
  updateOperator: (codigo: string, patch: Partial<Omit<Operator, 'id'>>) => gql.mutation<Operator>('catalogUpdateOperator', { codigo, ...patch }),
  linkOperatorUser: (codigo: string, usuId: number, cargo: 'ADMIN' | 'VENDEDOR' | 'GUIA') =>
    gql.mutation<void>('catalogLinkOperatorUser', { codigo, usu_id: usuId, cargo }),
  unlinkOperatorUser: (codigo: string, usuId: number) => gql.mutation<void>('catalogUnlinkOperatorUser', { codigo, usuId }),
  guides: (p: { operador?: string; activo?: '' | 'true' | 'false' } = {}, signal?: Signal) => gql.query<Guide[]>('catalogListGuides', clean(p), { signal }),
  createGuide: (body: { codigo: string; nombre: string; credencial_mintur: string; operador: string; usu_id?: number | null }) =>
    gql.mutation<Guide>('catalogCreateGuide', body),
  updateGuide: (codigo: string, patch: { nombre?: string; credencial_mintur?: string; usu_id?: number | null; activo?: boolean }) =>
    gql.mutation<Guide>('catalogUpdateGuide', { codigo, ...patch }),
};

export const locationApi = {
  provinces: (signal?: Signal) => gql.query<{ id: number; codigo: string; nombre: string }[]>('locationListProvinces', {}, { signal }),
};

/**
 * Recorre un listado paginado (tablero y reportes: no hay servicio de agregados). Se detiene en `maxPages`:
 * `truncated` avisa que el cálculo no cubre todos los registros.
 */
export async function collectPages<T>(load: (page: number) => Promise<AdminPage<T>>, maxPages = 20): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await load(page);
    items.push(...result.items);
    if (result.items.length === 0 || items.length >= result.total) return { items, truncated: false };
  }
  return { items, truncated: true };
}

/** Página de una lista que el servicio devuelve completa (sin paginar). */
export const pageOf = <T>(items: T[], page: number, limit: number): AdminPage<T> => ({ total: items.length, items: items.slice((page - 1) * limit, page * limit) });

// Pricing ------------------------------------------------------------------------

export const pricingApi = {
  get: (attractionId: string, signal?: Signal) => gql.query<PriceTable>('pricingGetPriceTable', { attraction_id: attractionId }, { signal }),
  set: (body: { attraction_id: string; valid_from?: string; adult: number; child: number; senior: number; student?: number }) =>
    gql.mutation<PriceTable>('pricingSetPriceTable', body),
};

// Inventory ----------------------------------------------------------------------

export const inventoryApi = {
  schedules: (atraccionId: string, signal?: Signal) =>
    gql.query<{ items: Schedule[] }>('inventoryListSchedules', { atraccion_id: atraccionId }, { signal }).then((r) => r.items ?? []),
  saveSchedule: (body: { hor_id: number; atraccion_id: string; hora: string; cupo: number; gui_id: number }) => gql.mutation<Schedule>('inventorySaveSchedule', body),
  setScheduleActive: (horId: number, activo: boolean) => gql.mutation<Schedule>('inventorySetScheduleActive', { hor_id: horId, activo }),
  slots: (p: PageParams & { atraccion_id: string; desde?: string; hasta?: string }, signal?: Signal) =>
    gql.query<{ total_results: number; items: Slot[] }>('inventoryListSlots', clean(p), { signal }).then((r) => ({ total: r.total_results, items: r.items ?? [] })),
  setCapacity: (atraccionId: string, slotId: string, cupoTotal: number) =>
    gql.mutation<Slot>('inventorySetSlotCapacity', { atraccion_id: atraccionId, slot_id: slotId, cupo_total: cupoTotal }),
  setClosed: (atraccionId: string, slotId: string, cerrada: boolean) => gql.mutation<Slot>('inventorySetSlotClosed', { atraccion_id: atraccionId, slot_id: slotId, cerrada }),
  /** `guiId` 0 = vuelve al guía del horario. */
  setSlotGuide: (atraccionId: string, slotId: string, guiId: number) => gql.mutation<Slot>('inventorySetSlotGuide', { atraccion_id: atraccionId, slot_id: slotId, gui_id: guiId }),
  setSlotsGuide: (body: { atraccion_id: string; desde: string; hasta: string; hor_id: number; dias_semana: number[]; gui_id: number }) =>
    gql.mutation<SlotsGuideResult>('inventorySetSlotsGuide', body),
  blockedDates: (atraccionId: string, signal?: Signal) =>
    gql.query<{ items: BlockedDate[] }>('inventoryListBlockedDates', { atraccion_id: atraccionId }, { signal }).then((r) => r.items ?? []),
  blockDate: (atraccionId: string, fecha: string, motivo: string) => gql.mutation<BlockedDate>('inventoryBlockDate', { atraccion_id: atraccionId, fecha, motivo }),
  unblockDate: (atraccionId: string, fecha: string) => gql.mutation<void>('inventoryUnblockDate', { atraccion_id: atraccionId, fecha }),
};

// Booking, Order, Payment, Refund, Invoicing ---------------------------------------

export const operationsApi = {
  reservations: (p: PageParams & { estado?: ReservationStatus | ''; q?: string }, signal?: Signal) =>
    gql
      .query<ReservationPage>('bookingListReservations', clean({ ...p, todas: true }), { signal })
      .then((r) => ({ total: r.total_results, items: r.items ?? [] }) as AdminPage<Reservation>),
  /** Como `ADMIN` no aplica el plazo de cancelación gratuita; Booking reembolsa y libera los cupos. */
  cancelReservation: (id: string, reason: string, idempotencyKey: string) =>
    gql.mutation<Reservation>('bookingCancelReservation', { id, reason, solicitante: 'ADMIN' }, { idempotencyKey }),
  orders: (p: PageParams & { estado?: OrderState | '' }, signal?: Signal) =>
    gql
      .query<{ total_results: number; items: OrderSummary[] }>('orderListOrders', clean({ ...p, todas: true }), { signal })
      .then((r) => ({ total: r.total_results, items: r.items ?? [] }) as AdminPage<OrderSummary>),
  payments: (p: PageParams & { estado?: PaymentState | ''; metodo?: PaymentMethodCode | '' }, signal?: Signal) =>
    gql.query<MetadataPage<Payment>>('paymentListPayments', clean(p), { signal }).then(fromMetadata),
  /** Reembolso parcial sin cancelar la reserva (no libera cupos). Sin `monto`, todo el saldo. */
  refund: (body: { ord_id: number; monto?: number; motivo?: string }, idempotencyKey: string) =>
    gql.mutation<Refund>('refundCreateRefund', body, { idempotencyKey }),
  invoices: (p: PageParams & { estado?: string; estado_sri?: string }, signal?: Signal) =>
    gql.query<MetadataPage<Invoice>>('invoicingListInvoices', clean(p), { signal }).then(fromMetadata),
};

// Review, Coupon, Support ----------------------------------------------------------

export const reviewsApi = {
  list: (p: PageParams & { visible?: '' | 'true' | 'false' }, signal?: Signal) =>
    gql.query<PaginationPage<AdminReview>>('reviewAdminListReviews', clean(p), { signal }).then(fromPagination),
  setVisible: (id: number, visible: boolean) => gql.mutation<AdminReview>('reviewSetReviewVisible', { id, visible }),
};

export const couponsApi = {
  list: (p: PageParams & { code?: string; active?: '' | 'true' | 'false' }, signal?: Signal) =>
    gql.query<MetadataPage<Coupon>>('couponListCoupons', clean(p), { signal }).then(fromMetadata),
  create: (body: Coupon) => gql.mutation<Coupon>('couponCreateCoupon', body),
  update: (code: string, patch: Partial<Pick<Coupon, 'start_date' | 'end_date' | 'max_uses' | 'active'>>) =>
    gql.mutation<Coupon>('couponUpdateCoupon', { code, ...patch }),
  agreement: (signal?: Signal) => gql.query<Agreement>('couponGetAgreement', {}, { signal }),
  updateAgreement: (body: { permite_promociones: boolean; porcentaje_descuento_maximo: number; destinos_habilitados: string[]; vigencia_hasta: string; condiciones_combo?: string }) =>
    gql.mutation<Agreement>('couponUpdateAgreement', body),
};

export const supportApi = {
  list: (p: PageParams & { leido?: '' | 'true' | 'false' }, signal?: Signal) =>
    gql.query<PaginationPage<ContactMessage>>('supportListMessages', clean(p), { signal }).then(fromPagination),
  setRead: (id: number, leido: boolean) => gql.mutation<ContactMessage>('supportSetMessageRead', { id, leido }),
};

// Audit y salud --------------------------------------------------------------------

export const auditApi = {
  list: (p: PageParams & { accion?: string; entidad?: string; entidad_id?: string; usu_id?: number; correlation_id?: string; desde?: string; hasta?: string }, signal?: Signal) =>
    gql.query<MetadataPage<AuditEntry>>('auditListEntries', clean(p), { signal }).then(fromMetadata),
  actions: (signal?: Signal) => gql.query<string[]>('auditListActions', {}, { signal }),
};

export const systemHealth = (signal?: Signal) =>
  gql.document<SystemHealth>(
    'query SystemHealth { systemHealth { status checkedAt services { service status latencyMs databaseConnected error } } }',
    'systemHealth',
    signal,
  );

/** Comprueba un endpoint `/health` público y mide cuánto tarda en responder. */
export async function checkHealth(url: string, signal?: AbortSignal): Promise<{ ok: boolean; latencyMs: number }> {
  const start = performance.now();
  try {
    const response = await fetch(url, { signal, cache: 'no-store' });
    return { ok: response.ok, latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, latencyMs: Math.round(performance.now() - start) };
  }
}
