/**
 * Esquema GraphQL del portal web (plan §3.10). Los valores cerrados (tipos de boleto, métodos de pago, estados de
 * reserva) son los del contrato `atracciones-openapi-v2.yaml`, igual que en el resto del sistema.
 */
export const typeDefs = /* GraphQL */ `
  "Fecha local YYYY-MM-DD (zona del negocio, America/Guayaquil)."
  scalar Date
  "Instante ISO 8601 en UTC."
  scalar DateTime
  scalar JSON

  enum TicketType { ADULT CHILD SENIOR STUDENT INFANT }
  enum PaymentMethod { TARJETA_CREDITO TRANSFERENCIA PAGO_EN_SITIO SOA_BOOKING_GATEWAY }
  enum ReservationStatus { PENDING CONFIRMED CHECKED_IN COMPLETED CANCELLED EXPIRED }
  enum OrderStatus { PENDIENTE CONFIRMADA CANCELADA FALLIDA }
  enum DocumentType { CEDULA PASAPORTE RUC }
  enum UserStatus { ACTIVO BLOQUEADO DESHABILITADO }
  enum SlotStatus { DISPONIBLE ULTIMOS_CUPOS AGOTADO }
  enum AttractionSort { POPULARITY PRICE_ASC PRICE_DESC RATING_DESC }
  enum ReservationSort { DATE_ASC DATE_DESC CREATED_DESC }
  enum ContactMessageStatus { NUEVO EN_PROCESO RESPONDIDO CERRADO }

  type Money { amount: Float!, currency: String! }

  # ---------------------------------------------------------------- Catálogo
  type Category {
    id: ID!
    name: String!
    slug: String!
    description: String
    icon: String
    includesFood: Boolean!
    includesTransport: Boolean!
    includesGuide: Boolean!
    children: [Category!]!
  }

  type Rating { score: Float!, reviews: Int!, cleanliness: Float!, service: Float!, valueForMoney: Float!, punctuality: Float! }

  "Tarifa vigente por tipo de boleto (los precios incluyen IVA)."
  type Tariff { currency: String!, adult: Float!, child: Float!, senior: Float!, infant: Float!, student: Float }

  type MeetingPoint { address: String!, latitude: Float, longitude: Float, instructions: String, googleMapsUrl: String }
  type Accessibility { wheelchair: Boolean!, stroller: Boolean!, serviceAnimals: Boolean! }
  type ItineraryStop { stop: Int!, time: String!, title: String!, description: String, durationMinutes: Int!, location: String }
  type Provider { name: String!, ruc: String!, emergencyPhone: String!, supportEmail: String! }

  type Attraction {
    "Código público inmutable (el mismo id que usa Booking)."
    id: ID!
    uuid: ID!
    slug: String!
    name: String!
    shortDescription: String!
    city: String!
    durationHours: Float!
    includesFood: Boolean!
    includesTransport: Boolean!
    includesGuide: Boolean!
    freeCancellation: Boolean!
    cancellationHours: Int!
    packageAllowed: Boolean!
    packageDiscountPercent: Float!
    photos: [String!]!
    rating: Rating!
    meetingPoint: MeetingPoint!
    tariff: Tariff
    "Precio de adulto vigente."
    priceFrom: Money
    description: String
    cancellationPolicy: String
    accessibility: Accessibility
    languages: [String!]!
    inclusions: [String!]!
    exclusions: [String!]!
    itinerary: [ItineraryStop!]!
    provider: Provider
    "Si el usuario autenticado la tiene en favoritos (false sin sesión)."
    isFavorite: Boolean!
  }

  type AttractionPage { items: [Attraction!]!, total: Int!, page: Int!, limit: Int!, totalPages: Int! }

  input AttractionFilter {
    query: String
    city: String
    categoryId: ID
    includesFood: Boolean
    includesTransport: Boolean
    includesGuide: Boolean
    minPrice: Float
    maxPrice: Float
    maxDurationHours: Float
    guideLanguage: String
    wheelchairAccessible: Boolean
    serviceAnimals: Boolean
    freeCancellation: Boolean
    "Con fechas, solo atracciones con algún turno con cupos para 'travelers' personas."
    dateFrom: Date
    dateTo: Date
    travelers: Int
  }

  type TimeSlot {
    "slot-YYYYMMDD-HHmm (como en el contrato)."
    slotId: ID!
    date: Date!
    "HH:mm (24 h)."
    time: String!
    "Etiqueta para mostrar (10:30 a.m.)."
    label: String!
    capacity: Int!
    available: Int!
    status: SlotStatus!
    adultPrice: Float
    childPrice: Float
    guide: String
  }

  # ---------------------------------------------------------------- Cuenta
  type User {
    id: ID!
    email: String!
    fullName: String!
    type: String!
    status: UserStatus!
    roles: [String!]!
    "Scopes del token con el que se hizo la consulta (solo en 'me')."
    scopes: [String!]!
    createdAt: DateTime!
  }

  type BillingInfo {
    documentType: DocumentType!
    documentId: String!
    legalName: String!
    email: String!
    phone: String
    address: String
    updatedAt: DateTime!
  }

  input BillingInput {
    documentType: DocumentType!
    documentId: String!
    legalName: String!
    email: String!
    phone: String
    address: String
  }

  # ---------------------------------------------------------------- Reservas y órdenes
  type TicketCount { type: TicketType!, quantity: Int! }
  type Customer { fullName: String!, email: String!, phone: String!, documentType: DocumentType!, documentId: String! }
  type Passenger { fullName: String!, documentId: String, ticketType: TicketType! }

  type Reservation {
    id: ID!
    "PNR (DEC-XXXXXX)."
    code: String!
    externalOrderId: String!
    status: ReservationStatus!
    attractionId: ID!
    attraction: Attraction
    date: Date!
    time: String!
    tickets: [TicketCount!]!
    ticketCount: Int!
    total: Money!
    customer: Customer!
    passengers: [Passenger!]!
    guide: String
    meetingPoint: String!
    notes: String
    "Voucher firmado para el QR del check-in."
    voucher: String!
    cancellableUntil: DateTime
    "El cliente aún puede cancelarla sin costo."
    canCancel: Boolean!
    checkedInAt: DateTime
    cancelledAt: DateTime
    cancellationReason: String
    refundCode: String
    refundedAmount: Float
    createdAt: DateTime!
    order: Order
    "Titular de la cuenta que la compró (administración)."
    owner: User
  }

  type ReservationPage { items: [Reservation!]!, total: Int!, limit: Int!, offset: Int! }

  type LineTicket { type: TicketType!, quantity: Int!, unitPrice: Float! }
  type OrderLine { attractionId: ID!, attraction: Attraction, date: Date!, time: String!, tickets: [LineTicket!]! }
  type SagaStep { step: String!, action: String!, result: String!, detail: String, at: DateTime! }
  type Refund { code: String!, amount: Float!, reason: String!, requestedBy: String!, status: String!, issuedAt: DateTime }

  type Payment {
    id: ID!
    orderId: ID!
    method: PaymentMethod!
    status: String!
    amount: Money!
    refunded: Float!
    gatewayReference: String
    rejectionReason: String
    createdAt: DateTime!
    processedAt: DateTime
    refunds: [Refund!]!
    order: Order
  }

  type Invoice {
    id: ID!
    "FACTURA o NOTA_CREDITO."
    type: String!
    number: String!
    accessKey: String!
    "Estado en el SRI: PENDIENTE, RECIBIDA, AUTORIZADA, DEVUELTA o NO_AUTORIZADA."
    status: String!
    authorizationNumber: String
    authorizedAt: DateTime
    attempts: Int!
    total: Float!
  }

  type Order {
    id: ID!
    externalOrderId: String!
    status: OrderStatus!
    sagaStatus: String!
    paymentMethod: PaymentMethod!
    total: Money!
    attractionId: ID
    attraction: Attraction
    date: Date
    time: String
    ticketCount: Int!
    createdAt: DateTime!
    updatedAt: DateTime!
    correlationId: String!
    lines: [OrderLine!]!
    steps: [SagaStep!]!
    payments: [Payment!]!
    invoices: [Invoice!]!
    reservation: Reservation
    owner: User
  }

  type OrderPage { items: [Order!]!, total: Int!, limit: Int!, offset: Int! }
  type PaymentPage { items: [Payment!]!, total: Int!, limit: Int!, offset: Int! }

  input TicketInput { type: TicketType!, quantity: Int! }
  input CustomerInput { fullName: String!, email: String!, phone: String!, documentType: DocumentType!, documentId: String! }
  input PassengerInput { fullName: String!, documentId: String, ticketType: TicketType! }

  input PurchaseInput {
    attractionId: ID!
    date: Date!
    "HH:mm"
    time: String!
    tickets: [TicketInput!]!
    customer: CustomerInput!
    passengers: [PassengerInput!]
    paymentMethod: PaymentMethod!
    notes: String
  }

  type PurchaseResult { reservation: Reservation!, order: Order }

  # ---------------------------------------------------------------- Carrito y favoritos
  type CartItem {
    id: ID!
    attractionId: ID!
    attraction: Attraction
    date: Date!
    time: String!
    tickets: [TicketCount!]!
    ticketCount: Int!
    "Estimado con la tarifa vigente de la fecha (el precio final lo fija la compra)."
    subtotal: Money
    "El turno sigue a la venta con cupos suficientes."
    available: Boolean!
  }

  type Cart { id: ID, items: [CartItem!]!, total: Money!, updatedAt: DateTime, expiresAt: DateTime }

  input CartItemInput { attractionId: ID!, date: Date!, time: String!, tickets: [TicketInput!]! }

  type ErrorInfo { code: String!, message: String!, status: Int! }
  type CheckoutResult { itemId: ID!, reservation: Reservation, error: ErrorInfo }

  # ---------------------------------------------------------------- Soporte
  type ContactMessage {
    id: ID!
    name: String!
    email: String!
    subject: String!
    message: String!
    status: ContactMessageStatus!
    createdAt: DateTime!
    respondedAt: DateTime
    correlationId: String!
  }
  type ContactMessagePage { items: [ContactMessage!]!, total: Int!, limit: Int!, offset: Int! }
  input ContactInput { name: String!, email: String!, subject: String!, message: String! }

  # ---------------------------------------------------------------- Administración
  type Role { name: String!, description: String, scopes: [String!]!, users: Int! }
  type UserPage { items: [User!]!, total: Int!, limit: Int!, offset: Int! }

  type AdminSlot {
    attractionId: ID!
    attraction: Attraction
    date: Date!
    time: String!
    capacity: Int!
    reserved: Int!
    available: Int!
    closed: Boolean!
    guide: String
  }
  type SlotPage { items: [AdminSlot!]!, total: Int!, limit: Int!, offset: Int! }
  type SlotsResult { created: Int!, updated: Int! }
  input SlotsInput { attractionId: ID!, from: Date!, to: Date, times: [String!]!, capacity: Int!, guideCode: String }
  input TariffInput { adult: Float!, child: Float!, senior: Float!, infant: Float!, student: Float, currency: String, validFrom: Date }

  type AdminAttraction {
    id: ID!
    uuid: ID!
    slug: String!
    name: String!
    city: String!
    categoryId: ID!
    category: String!
    active: Boolean!
    popularity: Int!
    priceFrom: Float
    photo: String
    updatedAt: DateTime!
  }
  type AdminAttractionPage { items: [AdminAttraction!]!, total: Int!, limit: Int!, offset: Int! }

  "Datos editables de una atracción, tal como se guardaron."
  type AttractionDraft {
    id: ID!
    uuid: ID!
    slug: String!
    active: Boolean!
    name: String!
    shortDescription: String!
    description: String!
    categoryId: ID!
    cityId: Int!
    providerCode: String!
    durationHours: Float!
    includesFood: Boolean!
    includesTransport: Boolean!
    includesGuide: Boolean!
    meetingPoint: MeetingPoint!
    accessibility: Accessibility!
    freeCancellation: Boolean!
    cancellationHours: Int!
    cancellationPolicy: String
    packageAllowed: Boolean!
    languages: [String!]!
    inclusions: [String!]!
    exclusions: [String!]!
    photos: [String!]!
    itinerary: [ItineraryStop!]!
    tariff: Tariff
  }

  input MeetingPointInput { address: String!, latitude: Float!, longitude: Float!, instructions: String, googleMapsUrl: String }
  input ItineraryStopInput { time: String!, title: String!, description: String, durationMinutes: Int!, location: String }
  input AttractionInput {
    name: String!
    shortDescription: String!
    description: String!
    categoryId: ID!
    cityId: Int!
    providerCode: String
    durationHours: Float!
    includesFood: Boolean
    includesTransport: Boolean
    includesGuide: Boolean
    meetingPoint: MeetingPointInput!
    wheelchair: Boolean
    stroller: Boolean
    serviceAnimals: Boolean
    freeCancellation: Boolean
    cancellationHours: Int
    cancellationPolicy: String
    packageAllowed: Boolean
    languages: [String!]
    inclusions: [String!]
    exclusions: [String!]
    photos: [String!]!
    itinerary: [ItineraryStopInput!]
  }

  type City { id: Int!, name: String!, province: String! }
  type CategoryOption { id: ID!, name: String!, parentId: ID, includesFood: Boolean!, includesTransport: Boolean!, includesGuide: Boolean! }
  type ProviderOption { code: String!, name: String! }
  type LanguageOption { code: String!, name: String! }
  type CatalogReferences { cities: [City!]!, categories: [CategoryOption!]!, providers: [ProviderOption!]!, languages: [LanguageOption!]! }

  type CountByKey { key: String!, count: Int!, amount: Float }
  type AdminDashboard {
    attractions: Int!
    activeAttractions: Int!
    users: Int!
    usersByStatus: [CountByKey!]!
    reservationsByStatus: [CountByKey!]!
    ordersByStatus: [CountByKey!]!
    revenue: Money!
    upcoming: UpcomingCapacity!
  }
  type UpcomingCapacity { slots: Int!, capacity: Int!, reserved: Int! }

  type SalesByAttraction { attractionId: ID!, attraction: Attraction, orders: Int!, tickets: Int!, revenue: Float! }
  type SalesByDay { date: Date!, orders: Int!, tickets: Int!, revenue: Float! }
  type SalesByMethod { method: PaymentMethod!, orders: Int!, revenue: Float! }
  type ReservationsByAttraction { attractionId: ID!, attraction: Attraction, reservations: Int!, tickets: Int! }
  type SalesReport {
    from: Date!
    to: Date!
    currency: String!
    revenue: Float!
    orders: Int!
    byAttraction: [SalesByAttraction!]!
    byDay: [SalesByDay!]!
    byMethod: [SalesByMethod!]!
    byStatus: [CountByKey!]!
    reservationsByAttraction: [ReservationsByAttraction!]!
  }

  type AuditEvent {
    eventId: ID!
    eventType: String!
    service: String!
    aggregateType: String!
    aggregateId: String!
    correlationId: String!
    payload: JSON!
    occurredAt: DateTime!
  }
  type AuditPage { items: [AuditEvent!]!, total: Int!, limit: Int!, offset: Int! }
  type EventType { name: String!, service: String!, aggregateType: String! }

  type ServiceHealth {
    service: String!
    status: String!
    latencyMs: Int!
    databaseConnected: Boolean
    memoryMb: Float
    uptimeSeconds: Int
    error: String
  }
  type SystemHealth { status: String!, checkedAt: DateTime!, services: [ServiceHealth!]! }

  type Query {
    categories: [Category!]!
    attractions(filter: AttractionFilter, sort: AttractionSort = POPULARITY, page: Int = 1, limit: Int = 12): AttractionPage!
    attraction(id: ID!): Attraction
    availability(attractionId: ID!, date: Date!): [TimeSlot!]!

    me: User
    myBilling: BillingInfo
    myReservations(status: ReservationStatus, from: Date, to: Date, sort: ReservationSort = CREATED_DESC, limit: Int = 10, offset: Int = 0): ReservationPage!
    reservation(id: ID!): Reservation
    myOrders(status: OrderStatus, limit: Int = 10, offset: Int = 0): OrderPage!
    order(id: ID!): Order
    cart: Cart!
    favorites: [Attraction!]!

    adminDashboard: AdminDashboard!
    adminUsers(search: String, status: UserStatus, role: String, limit: Int = 20, offset: Int = 0): UserPage!
    adminRoles: [Role!]!
    adminReservations(status: ReservationStatus, from: Date, to: Date, attractionId: ID, search: String, sort: ReservationSort = CREATED_DESC, limit: Int = 20, offset: Int = 0): ReservationPage!
    adminOrders(status: OrderStatus, from: Date, to: Date, search: String, paymentMethod: PaymentMethod, limit: Int = 20, offset: Int = 0): OrderPage!
    adminPayments(status: String, method: PaymentMethod, limit: Int = 20, offset: Int = 0): PaymentPage!
    adminSlots(attractionId: ID, from: Date, to: Date, limit: Int = 50, offset: Int = 0): SlotPage!
    adminAttractions(search: String, active: Boolean, limit: Int = 20, offset: Int = 0): AdminAttractionPage!
    adminAttraction(id: ID!): AttractionDraft
    catalogReferences: CatalogReferences!
    salesReport(from: Date, to: Date): SalesReport!
    auditLog(eventType: String, aggregateId: String, correlationId: String, service: String, from: Date, to: Date, limit: Int = 50, offset: Int = 0): AuditPage!
    eventTypes: [EventType!]!
    contactMessages(status: ContactMessageStatus, limit: Int = 20, offset: Int = 0): ContactMessagePage!
    systemHealth: SystemHealth!
  }

  type Mutation {
    updateProfile(fullName: String!): User!
    saveBilling(input: BillingInput!): BillingInfo!

    "Compra (saga de Order). La misma idempotencyKey (UUID) repite la misma respuesta."
    purchase(input: PurchaseInput!, idempotencyKey: ID!): PurchaseResult!
    cancelReservation(id: ID!, reason: String, idempotencyKey: ID!): Reservation!

    addToCart(input: CartItemInput!): Cart!
    updateCartItem(itemId: ID!, tickets: [TicketInput!]!): Cart!
    removeCartItem(itemId: ID!): Cart!
    clearCart: Cart!
    "Compra cada turno del carrito como una orden (una saga por ítem); los comprados salen del carrito."
    checkoutCart(customer: CustomerInput!, paymentMethod: PaymentMethod!, idempotencyKey: ID!, itemIds: [ID!]): [CheckoutResult!]!
    addFavorite(attractionId: ID!): [Attraction!]!
    removeFavorite(attractionId: ID!): [Attraction!]!

    sendContactMessage(input: ContactInput!): ContactMessage!

    createAttraction(input: AttractionInput!): AttractionDraft!
    updateAttraction(id: ID!, input: AttractionInput!): AttractionDraft!
    setAttractionActive(id: ID!, active: Boolean!): AttractionDraft!
    setTariff(attractionId: ID!, input: TariffInput!): Tariff!
    upsertSlots(input: SlotsInput!): SlotsResult!
    setSlotCapacity(attractionId: ID!, date: Date!, time: String!, capacity: Int!): AdminSlot!
    setSlotClosed(attractionId: ID!, date: Date!, time: String!, closed: Boolean!): AdminSlot!
    setUserStatus(userId: ID!, status: UserStatus!): User!
    grantRole(userId: ID!, role: String!, reason: String): User!
    revokeRole(userId: ID!, role: String!): User!
    "Cancelación por la tienda (solicitante ADMIN): sin plazo y con reembolso del 100 %."
    adminCancelReservation(id: ID!, reason: String!, idempotencyKey: ID!): Reservation!
    setContactMessageStatus(id: ID!, status: ContactMessageStatus!): ContactMessage!
  }
`;
