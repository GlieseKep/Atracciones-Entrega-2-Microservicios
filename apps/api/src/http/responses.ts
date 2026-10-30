import type {
  AttractionResult,
  AvailabilityResult,
  CustomerResult,
  OrderEventsResult,
  OrderResult,
  PaginationResult,
  PaymentSimulationResult,
  PaymentSummaryResult,
  PurchaseResult,
  RegisteredUserResult,
  ReservationResult,
  UserResult,
} from '@atracciones/business';
import type {
  AttractionResponse,
  AvailabilityResponse,
  CustomerResponse,
  OrderEventsResponse,
  OrderResponse,
  PagedResponse,
  PaymentSimulationResponse,
  PaymentSummaryDto,
  PurchaseResponse,
  RegisterProfileResponse,
  ReservationResponse,
  UserResponse,
} from '@atracciones/contracts';

/**
 * Prefijo provisional del API del portal. `/api/v1` y `/api/v2` pertenecen al contrato con Booking (Partner API);
 * este API se retira cuando el portal migre a GraphQL (plan §7.7, Fase 7).
 */
export const API_PREFIX = 'internal/web/v1';
export const apiPath = (relative: string) => `/${API_PREFIX}/${relative}`;
export const attractionLink = (id: string) => apiPath(`atracciones/${id}`);

/** Instante ISO 8601 en UTC. */
const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);
const isoOrNull = (value: Date | string | null): string | null => (value === null ? null : iso(value));

export function toPaged<TIn, TOut>(page: PaginationResult<TIn>, map: (item: TIn) => TOut): PagedResponse<TOut> {
  return { totalItems: page.totalItems, itemsPerPage: page.limit, currentPage: page.currentPage, totalPages: page.totalPages, data: page.items.map(map) };
}

export function toAttractionResponse(result: AttractionResult): AttractionResponse {
  const d = result.data;
  const self = attractionLink(result.id);
  return {
    id: result.id,
    name: d.name,
    longDescription: d.longDescription,
    duration: d.duration,
    price: { currency: d.price.currency, total: d.price.total },
    categories: d.categories,
    badges: d.badges,
    locations: d.locations.map((l) => ({
      address: l.address,
      city: l.city,
      country: l.country,
      type: l.type,
      coordinates: l.latitude !== null && l.longitude !== null ? { latitude: l.latitude, longitude: l.longitude } : null,
    })),
    photos: d.photoUrls.map((url) => ({ url })),
    operator: d.operator ? { id: d.operator.id, name: d.operator.name } : null,
    productType: d.productType,
    includes: d.includes,
    supportedLanguages: d.supportedLanguages,
    freeCancellation: d.freeCancellation,
    ratings: result.ratings,
    url: result.url,
    _links: { self, availability: `${self}/availability` },
  };
}

export function toAvailabilityResponse(result: AvailabilityResult): AvailabilityResponse {
  return {
    date: result.date,
    timeZone: result.timeZone,
    availableSpots: result.availableSpots,
    times: result.slots.map((s) => ({ time: s.time, availableSpots: s.availableSpots, status: s.availableSpots > 0 ? 'AVAILABLE' : 'SOLD_OUT' })),
  };
}

export const toReservationResponse = (r: ReservationResult): ReservationResponse => ({
  reservationId: r.reservationId,
  attractionId: r.attractionId,
  status: r.status,
  date: r.date,
  time: r.time,
  ticketCount: r.ticketCount,
  totalPrice: { ...r.totalPrice },
});

export const toRegisterResponse = (r: RegisteredUserResult): RegisterProfileResponse => ({
  id: r.id,
  email: r.email,
  status: r.status,
  customerId: r.customerId,
  createdAt: iso(r.createdAt),
});

export const toUserResponse = (r: UserResult): UserResponse => ({
  id: r.id,
  email: r.email,
  status: r.status,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

export const toCustomerResponse = (r: CustomerResult): CustomerResponse => ({ ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) });

const toPaymentSummary = (p: PaymentSummaryResult | null): PaymentSummaryDto | null => (p ? { ...p } : null);

export const toPurchaseResponse = (r: PurchaseResult): PurchaseResponse => ({
  ...r,
  unitPrice: { ...r.unitPrice },
  payment: toPaymentSummary(r.payment),
  holdExpiresAt: isoOrNull(r.holdExpiresAt),
  createdAt: iso(r.createdAt),
});

export const toOrderResponse = (r: OrderResult): OrderResponse => ({
  ...r,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
  items: r.items.map((i) => ({ ...i, unitPrice: { ...i.unitPrice } })),
  paymentSimulation: toPaymentSummary(r.paymentSimulation),
});

export const toOrderEventsResponse = (r: OrderEventsResult): OrderEventsResponse => ({
  orderId: r.orderId,
  events: r.events.map((e) => ({ ...e, createdAt: iso(e.createdAt) })),
});

export const toPaymentResponse = (r: PaymentSimulationResult): PaymentSimulationResponse => ({ ...r, createdAt: iso(r.createdAt) });
