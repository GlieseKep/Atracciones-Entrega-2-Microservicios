import type { IsoDate, IsoDateTime, PagedResponse } from '@/types/api';
import { createAttraction, deleteAttraction, patchAttraction, replaceAttraction } from './attractions';
import { http } from './client';

/**
 * Endpoints administrativos (`/admin`): scope `attractions:write` + permiso local `admin:manage` (rol `admin`).
 * El catálogo usa los endpoints de `/atracciones` con el permiso `catalog:write`.
 */
export const catalogAdmin = {
  create: createAttraction,
  replace: replaceAttraction,
  patch: patchAttraction,
  remove: deleteAttraction,
};

export const ADMIN_SCOPE = 'attractions:write';

export interface Money {
  currency: string;
  amount: number;
}

export interface AdminSummary {
  attractions: number;
  customers: number;
  activeUsers: number;
  reservationsByStatus: Record<string, number>;
  ordersByStatus: Record<string, number>;
  paymentsByStatus: Record<string, number>;
  revenue: Money[];
  upcoming: { slots: number; capacity: number; reserved: number };
}

export type UserStatus = 'ACTIVE' | 'LOCKED' | 'DISABLED';

export interface AdminCustomer {
  userId: string;
  customerId: string | null;
  email: string;
  name: string | null;
  status: UserStatus;
  billingName: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  taxId: string | null;
  createdAt: IsoDateTime;
  reservations: number;
  orders: number;
  totalSpent: number;
  lastActivityAt: IsoDateTime | null;
  roles: string[];
}

export interface AdminReservation {
  id: string;
  attractionId: string;
  attractionName: string;
  customerName: string;
  customerEmail: string;
  date: IsoDate;
  time: string;
  ticketCount: number;
  total: Money;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  cancellationReason: string | null;
  createdAt: IsoDateTime;
  /** Pedido de la compra que originó la reserva; null si se reservó sin pagar. */
  orderId: string | null;
  orderStatus: AdminOrder['status'] | null;
}

export interface AdminOrder {
  id: string;
  customerEmail: string;
  attractionName: string | null;
  serviceDate: IsoDate | null;
  serviceTime: string | null;
  quantity: number;
  status: 'PENDING_PAYMENT' | 'PAID' | 'FULFILLED' | 'CANCELLED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  total: Money;
  refunded: number;
  paymentStatus: AdminPayment['status'] | null;
  holdExpiresAt: IsoDateTime | null;
  reservationId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface AdminOrderPayment extends Omit<AdminPayment, 'orderId' | 'customerEmail'> {
  refunded: number;
  attemptsDetail: { attemptNumber: number; status: string; responseCode: string; responseMessage: string; createdAt: IsoDateTime }[];
  events: { eventType: string; createdAt: IsoDateTime; amount: number | null; reason: string | null }[];
}

export interface AdminOrderDetail extends AdminOrder {
  customerName: string | null;
  cancellationReason: string | null;
  reservationStatus: AdminReservation['status'] | null;
  items: { attractionId: string; attractionName: string; serviceDate: IsoDate; serviceTime: string; quantity: number; unitPrice: Money }[];
  events: { eventType: string; previousStatus: AdminOrder['status'] | null; newStatus: AdminOrder['status']; createdAt: IsoDateTime }[];
  payments: AdminOrderPayment[];
}

export interface AdminPayment {
  id: string;
  orderId: string;
  customerEmail: string;
  paymentMethod: 'CARD' | 'BANK_TRANSFER';
  status: 'PENDING' | 'AUTHORIZED' | 'SETTLED' | 'REJECTED' | 'FAILED' | 'CANCELLED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  amount: Money;
  gatewayReference: string;
  attempts: number;
  failureReason: string | null;
  createdAt: IsoDateTime;
  processedAt: IsoDateTime | null;
}

export interface AdminSlot {
  id: string;
  attractionId: string;
  attractionName: string;
  date: IsoDate;
  time: string;
  capacity: number;
  reserved: number;
}

export interface AdminRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  users: number;
}

export interface SalesReport {
  fromDate: IsoDate;
  toDate: IsoDate;
  currency: string;
  byAttraction: { attractionId: string; attractionName: string; orders: number; tickets: number; revenue: number }[];
  byDay: { date: IsoDate; orders: number; tickets: number; revenue: number }[];
  reservationsByAttraction: { attractionId: string; attractionName: string; reservations: number; tickets: number }[];
}

/** Métricas del API en memoria: se reinician cada vez que el proceso arranca. */
export interface Observability {
  checkedAt: IsoDateTime;
  database: { status: 'ok' | 'down'; latencyMs: number | null; error: string | null };
  startedAt: IsoDateTime;
  uptimeSeconds: number;
  requests: { total: number; byStatusClass: Record<string, number>; clientErrors: number; serverErrors: number };
  latencyMs: { p50: number; p95: number; p99: number; max: number; samples: number };
  timeline: { minute: IsoDateTime; requests: number; errors: number }[];
  routes: { route: string; count: number; errors: number; avgMs: number; maxMs: number }[];
  recentErrors: { at: IsoDateTime; method: string; path: string; status: number; durationMs: number; requestId: string | null }[];
  process: { node: string; memoryMb: { rss: number; heapUsed: number; heapTotal: number }; cpuSeconds: number };
}

export interface AdminAuditEvent {
  id: string;
  action: string;
  resourceType: 'attraction' | 'availability' | 'order' | 'user';
  resourceId: string;
  reason: string | null;
  actorEmail: string | null;
  actorSubject: string;
  createdAt: IsoDateTime;
}

export interface AdminListParams {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  fromDate?: IsoDate;
  toDate?: IsoDate;
  attractionId?: string;
}

const list = <T>(path: string) => (params: AdminListParams, signal?: AbortSignal) =>
  http.get<PagedResponse<T>>(path, { query: { ...params }, signal });

export const adminApi = {
  summary: (signal?: AbortSignal) => http.get<AdminSummary>('/admin/summary', { signal }),
  customers: list<AdminCustomer>('/admin/customers'),
  reservations: list<AdminReservation>('/admin/reservations'),
  orders: list<AdminOrder>('/admin/orders'),
  order: (orderId: string, signal?: AbortSignal) => http.get<AdminOrderDetail>(`/admin/orders/${orderId}`, { signal }),
  cancelOrder: (orderId: string, reason: string, idempotencyKey: string) =>
    http.post<AdminOrderDetail>(`/admin/orders/${orderId}/cancel`, { reason }, { idempotencyKey }),
  refundOrder: (orderId: string, body: { amount?: number; reason: string }, idempotencyKey: string) =>
    http.post<AdminOrderDetail>(`/admin/orders/${orderId}/refunds`, body, { idempotencyKey }),
  payments: list<AdminPayment>('/admin/payments'),
  availability: list<AdminSlot>('/admin/availability'),
  roles: (signal?: AbortSignal) => http.get<AdminRole[]>('/admin/roles', { signal }),
  salesReport: (fromDate: IsoDate, toDate: IsoDate, signal?: AbortSignal) =>
    http.get<SalesReport>('/admin/reports/sales', { query: { fromDate, toDate }, signal }),
  setUserStatus: (userId: string, status: UserStatus, reason?: string) =>
    http.put<AdminCustomer>(`/admin/customers/${userId}/status`, { status, reason }),
  assignRole: (userId: string, roleId: string, reason?: string) =>
    http.post<AdminCustomer>(`/admin/customers/${userId}/roles`, { roleId, reason }),
  revokeRole: (userId: string, roleId: string) => http.delete<AdminCustomer>(`/admin/customers/${userId}/roles/${roleId}`),
  updateCapacity: (slotId: string, capacity: number) => http.patch<AdminSlot>(`/admin/availability/${slotId}`, { capacity }),
  addSlot: (body: { attractionId: string; date: IsoDate; time: string; capacity: number }) =>
    http.post<AdminSlot>('/admin/availability', body),
  observability: (signal?: AbortSignal) => http.get<Observability>('/admin/observability', { signal }),
  audit: list<AdminAuditEvent>('/admin/audit'),
};

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
