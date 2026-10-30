/**
 * Tabla de rutas del ESB: `servicio.operación` → protocolo y destino (plan §3.10). El ESB no tiene lógica de negocio:
 * solo traduce la entrada JSON al protocolo del servicio y devuelve su respuesta.
 *
 * REST: los `:parametros` de la ruta se toman de la entrada; el resto va en la query (GET/DELETE) o en el cuerpo.
 * gRPC: la entrada es el mensaje del RPC.
 */
export interface RestRoute {
  protocol: 'rest';
  target: TargetName;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  timeoutMs?: number;
}

export interface GrpcRoute {
  protocol: 'grpc';
  target: TargetName;
  proto: string;
  service: string;
  method: string;
  timeoutMs?: number;
}

/** SOAP 1.1: la entrada son los parámetros de la operación; la salida, el contenido de `<operacionResponse>`. */
export interface SoapRoute {
  protocol: 'soap';
  target: TargetName;
  namespace: string;
  operation: string;
  timeoutMs?: number;
  /** El SRI real no conoce la cabecera de correlación: se puede omitir. */
  correlationHeader?: boolean;
}

export type Route = RestRoute | GrpcRoute | SoapRoute;

/** Destinos: URL base para REST, `host:puerto` para gRPC, URL del endpoint para SOAP. */
export type TargetName = 'identity' | 'catalog' | 'inventory' | 'cart' | 'order' | 'booking' | 'payment' | 'invoicing' | 'audit' | 'sri_recepcion' | 'sri_autorizacion';

const inventory = (method: string, timeoutMs = 2000): GrpcRoute => ({ protocol: 'grpc', target: 'inventory', proto: 'internal/inventory.proto', service: 'atracciones.inventory.InventoryService', method, timeoutMs });
const order = (method: string, timeoutMs = 9000): GrpcRoute => ({ protocol: 'grpc', target: 'order', proto: 'internal/order.proto', service: 'atracciones.order.OrderService', method, timeoutMs });
const booking = (method: string, timeoutMs = 2000): GrpcRoute => ({ protocol: 'grpc', target: 'booking', proto: 'internal/booking.proto', service: 'atracciones.booking.BookingService', method, timeoutMs });

const health = (target: TargetName): RestRoute => ({ protocol: 'rest', target, method: 'GET', path: '/health', timeoutMs: 1000 });
const rest = (target: TargetName, method: RestRoute['method'], path: string, timeoutMs = 3000): RestRoute => ({ protocol: 'rest', target, method, path, timeoutMs });

export const ROUTES: Record<string, Route> = {
  // Salud de cada servicio (la agrega la Partner API en GET /atracciones/health).
  'identity.health': health('identity'),
  'catalog.health': health('catalog'),
  'payment.health': health('payment'),
  'audit.health': health('audit'),
  'cart.health': health('cart'),
  'invoicing.health': health('invoicing'),
  'inventory.health': inventory('Health', 1000),
  'order.health': order('Health', 1000),
  'booking.health': booking('Health', 1000),

  // Identity (REST)
  'identity.verifyApiKey': { protocol: 'rest', target: 'identity', method: 'POST', path: '/internal/api-keys/verify', timeoutMs: 2000 },
  'identity.getProfile': rest('identity', 'GET', '/usuarios/me'),
  'identity.updateProfile': rest('identity', 'PUT', '/usuarios/me'),
  'identity.getBilling': rest('identity', 'GET', '/usuarios/me/facturacion'),
  'identity.saveBilling': rest('identity', 'PUT', '/usuarios/me/facturacion'),
  'identity.listUsers': rest('identity', 'GET', '/usuarios'),
  'identity.getUsers': rest('identity', 'POST', '/usuarios/lote'),
  'identity.userStats': rest('identity', 'GET', '/usuarios/estadisticas'),
  'identity.setUserStatus': rest('identity', 'PUT', '/usuarios/:id/estado'),
  'identity.grantRole': rest('identity', 'POST', '/usuarios/:id/roles'),
  'identity.revokeRole': rest('identity', 'DELETE', '/usuarios/:id/roles/:rol'),
  'identity.listRoles': rest('identity', 'GET', '/roles'),

  // Catalog (REST)
  'catalog.getCategoryTree': { protocol: 'rest', target: 'catalog', method: 'GET', path: '/categorias/arbol' },
  'catalog.listCategories': { protocol: 'rest', target: 'catalog', method: 'GET', path: '/categorias' },
  'catalog.searchAttractions': { protocol: 'rest', target: 'catalog', method: 'POST', path: '/atracciones/busqueda' },
  'catalog.getAttraction': { protocol: 'rest', target: 'catalog', method: 'GET', path: '/atracciones/:id' },
  'catalog.getPromotionAgreement': { protocol: 'rest', target: 'catalog', method: 'GET', path: '/promociones/contrato' },
  'catalog.updatePromotionAgreement': { protocol: 'rest', target: 'catalog', method: 'PUT', path: '/promociones/contrato' },
  'catalog.getReferences': rest('catalog', 'GET', '/referencias'),
  'catalog.adminListAttractions': rest('catalog', 'GET', '/admin/atracciones'),
  'catalog.adminGetAttraction': rest('catalog', 'GET', '/admin/atracciones/:codigo'),
  'catalog.adminCreateAttraction': rest('catalog', 'POST', '/admin/atracciones'),
  'catalog.adminUpdateAttraction': rest('catalog', 'PUT', '/admin/atracciones/:codigo'),
  'catalog.adminSetAttractionActive': rest('catalog', 'PUT', '/admin/atracciones/:codigo/estado'),

  // Inventory (gRPC)
  'inventory.getAvailability': inventory('GetAvailability'),
  'inventory.getTariff': inventory('GetTariff'),
  'inventory.getTariffs': inventory('GetTariffs'),
  'inventory.getGuide': inventory('GetGuide'),
  'inventory.hasAvailability': inventory('HasAvailability'),
  'inventory.reserveSeats': inventory('ReserveSeats'),
  'inventory.releaseSeats': inventory('ReleaseSeats'),
  'inventory.listSlots': inventory('ListSlots'),
  'inventory.upsertSlots': inventory('UpsertSlots', 10_000),
  'inventory.setSlotCapacity': inventory('SetSlotCapacity'),
  'inventory.setSlotClosed': inventory('SetSlotClosed'),
  'inventory.setTariff': inventory('SetTariff'),
  'inventory.capacitySummary': inventory('CapacitySummary'),

  // Cart (REST)
  'cart.getCart': rest('cart', 'GET', '/carrito'),
  'cart.addItem': rest('cart', 'POST', '/carrito/items'),
  'cart.updateItem': rest('cart', 'PUT', '/carrito/items/:id'),
  'cart.removeItem': rest('cart', 'DELETE', '/carrito/items/:id'),
  'cart.markPurchased': rest('cart', 'POST', '/carrito/comprados'),
  'cart.clear': rest('cart', 'DELETE', '/carrito'),
  'cart.listFavorites': rest('cart', 'GET', '/favoritos'),
  'cart.addFavorite': rest('cart', 'PUT', '/favoritos/:codigo'),
  'cart.removeFavorite': rest('cart', 'DELETE', '/favoritos/:codigo'),

  // Order (gRPC) — orquesta las sagas: plazo mayor que el de cada paso.
  'order.createOrder': order('CreateOrder'),
  'order.cancelReservation': order('CancelReservation'),
  'order.getOrder': order('GetOrder', 5000),
  'order.listOrders': order('ListOrders', 3000),
  'order.salesReport': order('SalesReport', 5000),

  // Booking (gRPC)
  'booking.createReservation': booking('CreateReservation'),
  'booking.getReservation': booking('GetReservation'),
  'booking.cancelReservation': booking('CancelReservation'),
  'booking.checkIn': booking('CheckIn'),
  'booking.listReservations': booking('ListReservations', 3000),
  'booking.reservationStats': booking('ReservationStats', 3000),

  // Payment (REST)
  'payment.registerPayment': { protocol: 'rest', target: 'payment', method: 'POST', path: '/pagos', timeoutMs: 3000 },
  'payment.voidPayment': { protocol: 'rest', target: 'payment', method: 'POST', path: '/pagos/anulacion', timeoutMs: 3000 },
  'payment.refund': { protocol: 'rest', target: 'payment', method: 'POST', path: '/reembolsos', timeoutMs: 3000 },
  'payment.getPaymentByKey': rest('payment', 'GET', '/pagos/clave/:clave', 2000),
  'payment.listOrderPayments': rest('payment', 'GET', '/pagos/orden/:orden_id'),
  'payment.listPayments': rest('payment', 'GET', '/pagos'),

  // Invoicing (REST de consulta; la emisión es por eventos y SOAP con el SRI)
  'invoicing.listInvoices': rest('invoicing', 'GET', '/facturas'),

  // Audit (REST)
  'audit.listIntegrationEvents': { protocol: 'rest', target: 'audit', method: 'GET', path: '/eventos' },
  'audit.sendContactMessage': rest('audit', 'POST', '/mensajes-contacto'),
  'audit.listContactMessages': rest('audit', 'GET', '/mensajes-contacto'),
  'audit.setContactMessageStatus': rest('audit', 'PUT', '/mensajes-contacto/:id/estado'),
  'audit.listAuditLog': rest('audit', 'GET', '/bitacora'),
  'audit.listEventTypes': rest('audit', 'GET', '/bitacora/tipos'),

  // SRI del Ecuador (SOAP, comprobantes electrónicos offline): Invoicing los llama a través del ESB.
  'sri.validarComprobante': { protocol: 'soap', target: 'sri_recepcion', namespace: 'http://ec.gob.sri.ws.recepcion', operation: 'validarComprobante', timeoutMs: 15_000 },
  'sri.autorizacionComprobante': { protocol: 'soap', target: 'sri_autorizacion', namespace: 'http://ec.gob.sri.ws.autorizacion', operation: 'autorizacionComprobante', timeoutMs: 15_000 },
};
