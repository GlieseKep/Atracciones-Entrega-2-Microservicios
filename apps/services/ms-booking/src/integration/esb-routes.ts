/** Rutas del ESB hacia Booking (`servicio.operación` → `POST /internal/rpc/<Método>`), con la misma forma que `RestRoute` de `apps/esb/src/routes.ts`. */
export interface BookingRestRoute {
  protocol: 'rest';
  target: 'booking';
  method: 'POST';
  path: string;
  timeoutMs: number;
}

const route = (method: string, timeoutMs = 4000): BookingRestRoute => ({
  protocol: 'rest', target: 'booking', method: 'POST', path: `/internal/rpc/${method}`, timeoutMs,
});

export const MS_BOOKING_ROUTES = {
  'booking.health': route('Health', 1000),
  // La compra recorre Catalog, Order, Inventory y Payment. La cancelación, Order e Inventory (y Refund en reservas de Booking con pago aprobado).
  'booking.createReservation': route('CreateReservation', 20000),
  'booking.cancelReservation': route('CancelReservation', 15000),
  'booking.getReservation': route('GetReservation'),
  'booking.checkIn': route('CheckIn', 6000),
  'booking.listEvents': route('ListEvents'),
  'booking.listReservations': route('ListReservations', 8000),
} as const satisfies Record<string, BookingRestRoute>;

export type BookingRouteKey = keyof typeof MS_BOOKING_ROUTES;

/** Nombre de la operación para `EsbClient.call('booking', operación)` (`booking.getReservation` → `getReservation`). */
export type BookingOperation = BookingRouteKey extends `booking.${infer O}` ? O : never;
