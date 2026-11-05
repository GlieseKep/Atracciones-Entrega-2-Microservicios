/**
 * Operaciones del ESB que el portal puede usar por GraphQL. Cada una es un campo `<servicio><Operación>` (por ejemplo
 * `catalogListAttractions`) con la entrada en `input` y la respuesta tal como la devuelve el servicio.
 *
 * Quedan fuera las rutas `/internal/**`, la sesión (`/api/v3/auth`, que el Gateway envía directo a Identity) y los pasos
 * internos de la compra (orden, cobro y cupos), que orquesta Booking. Cada servicio aplica sus permisos con el principal
 * que firma el Gateway.
 */
export interface Operation {
  service: string;
  operation: string;
  kind: 'query' | 'mutation';
  /** Respuesta guardada en caché (segundos), solo para lecturas públicas que cambian poco. */
  cacheSeconds?: number;
  /** Necesita `Idempotency-Key`: Booking la lee del cuerpo y los servicios REST de la cabecera. */
  idempotent?: boolean;
}

const q = (service: string, operation: string, cacheSeconds?: number): Operation => ({ service, operation, kind: 'query', cacheSeconds });
const m = (service: string, operation: string, idempotent = false): Operation => ({ service, operation, kind: 'mutation', idempotent });

export const OPERATIONS: Operation[] = [
  // Identity: perfil y administración de cuentas.
  q('identity', 'getMe'),
  m('identity', 'updateMe'),
  m('identity', 'changePassword'),
  q('identity', 'listUsers'),
  q('identity', 'getUser'),
  m('identity', 'updateUser'),
  m('identity', 'setUserActive'),
  m('identity', 'assignRole'),
  m('identity', 'removeRole'),
  q('identity', 'listRoles'),
  q('identity', 'listApiClients'),
  m('identity', 'createApiClient'),
  m('identity', 'updateApiClient'),
  m('identity', 'regenerateApiClientKey'),
  m('identity', 'setApiClientActive'),

  // Location.
  q('location', 'getTree', 300),
  q('location', 'listProvinces', 300),
  q('location', 'getProvince', 300),
  q('location', 'listCities', 300),
  q('location', 'getCity', 300),

  // Catalog.
  q('catalog', 'getCategoryTree', 60),
  q('catalog', 'listCategories', 60),
  q('catalog', 'searchAttractions'),
  q('catalog', 'listAttractions'),
  q('catalog', 'getAttraction', 30),
  q('catalog', 'listGuides'),
  m('catalog', 'createGuide'),
  q('catalog', 'getGuide'),
  m('catalog', 'updateGuide'),
  q('catalog', 'listOperators'),
  m('catalog', 'createOperator'),
  m('catalog', 'updateOperator'),
  q('catalog', 'listOperatorUsers'),
  m('catalog', 'linkOperatorUser'),
  m('catalog', 'unlinkOperatorUser'),
  q('catalog', 'adminListCategories'),
  m('catalog', 'createCategory'),
  m('catalog', 'updateCategory'),
  q('catalog', 'listLanguages', 300),
  q('catalog', 'adminListLanguages'),
  m('catalog', 'createLanguage'),
  m('catalog', 'updateLanguage'),
  m('catalog', 'deleteLanguage'),
  q('catalog', 'listInclusions'),
  m('catalog', 'createInclusion'),
  m('catalog', 'deleteInclusion'),
  q('catalog', 'adminListAttractions'),
  m('catalog', 'adminCreateAttraction'),
  q('catalog', 'adminGetAttraction'),
  m('catalog', 'adminUpdateAttraction'),
  m('catalog', 'adminDeleteAttraction'),
  m('catalog', 'adminSetAttractionState'),

  // Billing Profile.
  q('billing', 'listProfiles'),
  m('billing', 'createProfile'),
  m('billing', 'replaceProfile'),
  m('billing', 'deleteProfile'),
  m('billing', 'markPrincipal'),

  // Pricing.
  q('pricing', 'quoteTickets'),
  q('pricing', 'getPriceTable'),
  q('pricing', 'listTariffs'),
  m('pricing', 'setPriceTable'),

  // Inventory.
  q('inventory', 'getAvailability'),
  q('inventory', 'listScheduleTimes'),
  q('inventory', 'listSchedules'),
  m('inventory', 'saveSchedule'),
  m('inventory', 'setScheduleActive'),
  q('inventory', 'listSlots'),
  m('inventory', 'setSlotCapacity'),
  m('inventory', 'setSlotClosed'),
  m('inventory', 'setSlotGuide'),
  m('inventory', 'setSlotsGuide'),
  q('inventory', 'listBlockedDates'),
  m('inventory', 'blockDate'),
  m('inventory', 'unblockDate'),

  // Review.
  q('review', 'listReviews'),
  m('review', 'createReview'),
  m('review', 'createAnonymousReview'),
  q('review', 'listMyReviews'),
  m('review', 'updateMyReview'),
  q('review', 'adminListReviews'),
  m('review', 'setReviewVisible'),

  // Coupon.
  q('coupon', 'getAgreement'),
  m('coupon', 'updateAgreement'),
  q('coupon', 'validateCoupon'),
  q('coupon', 'listCoupons'),
  m('coupon', 'createCoupon'),
  q('coupon', 'getCoupon'),
  m('coupon', 'updateCoupon'),

  // Cart.
  q('cart', 'getCart'),
  m('cart', 'clearCart'),
  m('cart', 'addItem'),
  m('cart', 'updateItem'),
  m('cart', 'removeItem'),

  // Payment: el cobro lo inicia Booking; el portal consulta y envía el comprobante de una transferencia.
  q('payment', 'listMethods', 300),
  q('payment', 'listOrderPayments'),
  q('payment', 'getPayment'),
  q('payment', 'listPayments'),
  m('payment', 'submitTransfer'),

  // Order: solo consultas (la orden la crea Booking en la compra).
  q('order', 'getOrder'),
  q('order', 'listOrders'),

  // Booking: compra, cancelación y check-in.
  m('booking', 'createReservation', true),
  m('booking', 'cancelReservation', true),
  q('booking', 'getReservation'),
  m('booking', 'checkIn', true),
  q('booking', 'listEvents'),
  q('booking', 'listReservations'),

  // Refund.
  m('refund', 'createRefund', true),
  q('refund', 'listRefunds'),
  q('refund', 'getRefund'),

  // Invoicing.
  q('invoicing', 'listInvoices'),
  q('invoicing', 'getInvoice'),
  q('invoicing', 'getOrderInvoice'),

  // Support.
  m('support', 'sendMessage'),
  q('support', 'listMessages'),
  m('support', 'setMessageRead'),

  // Audit.
  q('audit', 'listEntries'),
  q('audit', 'listActions'),
];

/** Servicios cuya salud se agrega en `systemHealth`. */
export const SERVICES = [...new Set(OPERATIONS.map((op) => op.service))];

/** Nombre del campo GraphQL: `catalog` + `listAttractions` → `catalogListAttractions`. */
export const fieldName = (op: Operation) => `${op.service}${op.operation[0].toUpperCase()}${op.operation.slice(1)}`;
