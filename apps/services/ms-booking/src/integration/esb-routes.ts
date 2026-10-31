/** Rutas del ESB hacia Booking (`servicio.operación` → método gRPC), con la misma forma que `GrpcRoute` de `apps/esb/src/routes.ts`. */
export interface BookingGrpcRoute {
  protocol: 'grpc';
  target: 'booking';
  proto: 'internal/ms-booking.proto';
  service: 'descubre.booking.BookingService';
  method: string;
  timeoutMs: number;
}

const route = (method: string, timeoutMs = 4000): BookingGrpcRoute => ({
  protocol: 'grpc', target: 'booking', proto: 'internal/ms-booking.proto', service: 'descubre.booking.BookingService', method, timeoutMs,
});

export const MS_BOOKING_ROUTES = {
  'booking.health': route('Health', 1000),
  // La compra y la cancelación recorren Catalog, Order, Inventory, Payment y Refund.
  'booking.createReservation': route('CreateReservation', 20000),
  'booking.cancelReservation': route('CancelReservation', 15000),
  'booking.getReservation': route('GetReservation'),
  'booking.checkIn': route('CheckIn', 6000),
  'booking.listEvents': route('ListEvents'),
  'booking.listReservations': route('ListReservations', 8000),
} as const satisfies Record<string, BookingGrpcRoute>;

export type BookingRouteKey = keyof typeof MS_BOOKING_ROUTES;

/** Nombre de la operación para `EsbClient.call('booking', operación)` (`booking.getReservation` → `getReservation`). */
export type BookingOperation = BookingRouteKey extends `booking.${infer O}` ? O : never;
