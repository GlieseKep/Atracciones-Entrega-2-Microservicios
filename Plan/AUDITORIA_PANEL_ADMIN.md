# Auditoría del panel administrativo · AtraccionesService-web

| | |
|---|---|
| Fecha | 2026-11-05 |
| Alcance | `src/pages/admin/*`, `src/pages/admin/legacy.ts`, `src/api/admin.ts` |
| Fuera de alcance | Portal público (ya migrado según `AUDITORIA_FRONTEND.md`) y el check-in (`AdminCheckinPage`), que ya usa `bookingGetReservation` y `bookingCheckIn` |
| Backend de referencia | Gateway `https://tourgirls-gateway-mm.azurewebsites.net` → GraphQL `/graphql` (operaciones de `apps/graphql/src/operations.ts`) |

## 1. Resumen

1. **Ninguna pantalla del panel funciona**, salvo el check-in. Todas llaman a `/admin/*` y `/atracciones` (CRUD) del monolito
   borrado. Con el cliente nuevo esas rutas van a la Partner API, que responde 404.
2. **Todo lo que el panel necesita ya existe como operación GraphQL** (`identity*`, `catalogAdmin*`, `inventory*`, `pricing*`,
   `order*`, `payment*`, `refund*`, `booking*`, `review*`, `coupon*`, `support*`, `audit*`, `systemHealth`). Las respuestas usan
   los nombres de cada servicio (`snake_case`, `metadata` + `data`), no los del monolito (`totalItems`, `camelCase`).
3. **No hay endpoints de agregados**: no existen `summary`, `salesReport` ni `observability`. El tablero y los reportes se
   arman en el panel con los totales de los listados (`total_results`) y con `systemHealth`.
4. **Gestión de usuarios:** hoy el panel trata a los usuarios como "clientes" del monolito, con estados `ACTIVE/LOCKED/DISABLED`
   y roles con id. ms-identity maneja otra cosa: `activo` (sí/no) y los roles `ADMIN`, `OPERADOR`, `GUIA` y `CLIENTE` por nombre.
   Dar `ADMIN` a un usuario ya es posible con `identityAssignRole`. **No existe crear una cuenta desde el panel** (ver §4.3).
5. **Identity:** ya se bloqueó que un administrador se quite su propio `ADMIN`, así que el sistema no puede quedar sin
   administradores. Los cambios de roles y cuentas todavía no llegan a la bitácora (ver §4.4).

Corregir las rutas **no basta**: hay que reescribir `src/api/admin.ts` sobre GraphQL, cambiar los tipos y rehacer las tablas
con los campos nuevos.

---

## 2. Conexiones actuales y su reemplazo

Todas pasan a GraphQL (`gql.query` / `gql.mutation` de `src/api/client.ts`). Las mutaciones marcadas con † llevan
`idempotencyKey`.

### 2.1 Tablero (`AdminDashboardPage`)

| Hoy | Problema | Reemplazo |
|---|---|---|
| `adminApi.summary` → `GET /admin/summary` | No existe | Contadores con `total_results` (`limit: 1`): `identityListUsers`, `catalogAdminListAttractions`, `bookingListReservations { todas: true, estado }` por estado, `orderListOrders { todas: true, estado }` por estado y `paymentListPayments { estado }`. Estado del sistema: `systemHealth` |
| `revenue` (ingresos) | Ningún servicio suma ingresos | Suma de `orden.total` de `orderListOrders { todas, estado: 'PAGADA' }` (paginando). Si pesa demasiado, se propone `orderSummary` en ms-order (decisión pendiente, ver §5) |
| `upcoming` (turnos y cupos próximos) | No existe | `inventoryListSlots` por atracción entre hoy y +7 días. Con muchas atracciones conviene mostrarlo solo en Disponibilidad |

### 2.2 Catálogo (`AdminCatalogPage`, `legacy.ts`)

| Hoy | Reemplazo |
|---|---|
| `listAttractions` → `GET /atracciones?limit&offset` | `catalogAdminListAttractions { page, limit≤50, q?, estado?, operador? }` (incluye inactivas y borradores) |
| `catalogAdmin.create` → `POST /atracciones` | `catalogAdminCreateAttraction` con el cuerpo de `Plan/ms_catalog/ms_catalog-openapi.yaml` (código, nombre, descripciones, ciudad, categoría, operador, duración, inclusiones, idiomas, accesibilidad, cancelación, punto de encuentro, fotos, itinerario) |
| `catalogAdmin.replace` → `PUT /atracciones/{id}` | `catalogAdminUpdateAttraction { id, … }` (ruta `PUT /admin/atracciones/:id`) |
| `catalogAdmin.remove` → `DELETE /atracciones/{id}` | `catalogAdminDeleteAttraction { id }`; para pausar sin borrar, `catalogAdminSetAttractionState { id, estado }` |
| Formulario con `price.total`, `productType`, `PT2H`, `locations[]` | Ya no aplica: el precio vive en **ms-pricing** y los horarios en **ms-inventory**. El editor debe tener pestañas: Ficha (Catalog), Tarifas (`pricingGetPriceTable` / `pricingSetPriceTable { attraction_id, valid_from, adult, child, senior, student? }`) y Horarios (§2.3) |
| Ciudad en texto libre | `locationListCities` (selector) |
| Categorías en texto libre | `catalogGetCategoryTree` / `catalogListCategories`; alta y edición con `catalogCreateCategory` / `catalogUpdateCategory` |
| — (no existe en el panel) | Operadores: `catalogListOperators`, `catalogCreateOperator`, `catalogUpdateOperator`. Guías: sección propia (§2.9). Inclusiones: `catalogListInclusions`, `catalogCreateInclusion`. Idiomas: `catalogListLanguages` |

### 2.3 Disponibilidad (`AdminAvailabilityPage`)

| Hoy | Reemplazo |
|---|---|
| `adminApi.availability` → `GET /admin/availability` | `inventoryListSlots { atraccion_id, desde, hasta, page, limit }` (una atracción a la vez) |
| `adminApi.updateCapacity` → `PATCH /admin/availability/{id}` | `inventorySetSlotCapacity { atraccion_id, slot_id, cupo_total }` |
| `adminApi.addSlot` → `POST /admin/availability` | No se crean turnos sueltos: se guarda un **horario** (`inventorySaveSchedule { hor_id: 0, atraccion_id, hora, cupo }`) e Inventory genera los turnos. Ver y pausar horarios: `inventoryListSchedules`, `inventorySetScheduleActive` |
| — | Cerrar un turno: `inventorySetSlotClosed`. Bloquear un día (feriado, clima): `inventoryBlockDate { atraccion_id, fecha, motivo }`, `inventoryUnblockDate`, `inventoryListBlockedDates` |
| Ids de turno UUID | `slot_id` del contrato (`slot-20261025-1030`) |

### 2.4 Reservas, pedidos, pagos y reembolsos (`AdminOperationsPages`, `AdminOrdersPage`)

| Hoy | Reemplazo |
|---|---|
| `adminApi.reservations` → `GET /admin/reservations` | `bookingListReservations { todas: true, estado?, page, limit }` (`{ total_results, items }`). Nombre y enlace de la atracción: `attraction_id` y `attraction_name`. Canal y aviso a Booking Central: `client_id` y `notificacion_booking` |
| `adminApi.orders` → `GET /admin/orders` | `orderListOrders { todas: true, estado?, page, limit }`. Estados `CREADA`, `PAGADA`, `CANCELADA` y `REEMBOLSADA` |
| `adminApi.order` → `GET /admin/orders/{id}` | `orderGetOrder { ord_numero }` + `paymentListOrderPayments { ordId }` + `refundListRefunds` + `invoicingGetOrderInvoice { ordId }` + bitácora `auditListEntries { correlation_id }` |
| `adminApi.cancelOrder` → `POST /admin/orders/{id}/cancel` | **Por la reserva, no por la orden**: `bookingCancelReservation † { id, reason, solicitante: 'ADMIN' }`. Booking reembolsa, libera cupos y cancela la orden en un paso; como `ADMIN` no aplica el plazo de cancelación gratuita. `orderCancelOrder` no está en GraphQL a propósito |
| `adminApi.refundOrder` → `POST /admin/orders/{id}/refunds` | `refundCreateRefund † { ord_id, monto?, motivo? }`, solo para reembolsos parciales sin cancelar. Advertirlo en la interfaz: no libera cupos |
| `adminApi.payments` → `GET /admin/payments` | `paymentListPayments { estado?, metodo?, page, limit }`; detalle `paymentGetPayment` |
| Estados `PENDING_PAYMENT`, `PAID`, `FULFILLED`… y `CARD` / `BANK_TRANSFER` | Estados de cada servicio: reserva (6 del contrato), orden (4), pago (de ms-payment) y método (`CREDIT_CARD`, `DEBIT_CARD`, `PAYPAL`, `TRANSFER`) |
| — | Transferencias pendientes de revisar: `paymentListPayments { metodo: 'TRANSFER', estado: 'PENDIENTE' }` |
| — | Eventos del contrato con Booking: `bookingListEvents` |

### 2.5 Reportes (`AdminReportsPage`)

| Hoy | Problema | Reemplazo |
|---|---|---|
| `adminApi.salesReport` → `GET /admin/reports/sales` | No existe ningún reporte | Se calcula en el panel: `orderListOrders { todas, estado: 'PAGADA' }` (paginando, filtrado por `fecha`) agrupado por día y por atracción (`lineas[].descripcion`); boletos con `bookingListReservations { todas }`. Facturas: `invoicingListInvoices { estado, estado_sri }`. Para volúmenes reales, decisión pendiente (§5) |

### 2.6 Observabilidad (`AdminObservabilityPage`)

| Hoy | Reemplazo |
|---|---|
| `adminApi.observability` → `GET /admin/observability` (métricas HTTP del monolito) | `systemHealth`: estado, latencia y base de datos de cada uno de los 16 servicios por el ESB |
| `checkHealth(apiOrigin/health)` y `/atracciones/health` | Se mantienen como semáforo del Gateway y de la Partner API |
| `adminApi.audit` → `GET /admin/audit` | `auditListEntries { accion?, entidad?, entidad_id?, correlation_id?, usu_id?, desde?, hasta?, page, limit }`; los tipos de acción salen de `auditListActions` (no de la tabla escrita en el código) |

### 2.7 Otros módulos que el panel no tiene y ya existen

| Módulo | Operaciones |
|---|---|
| Reseñas | `reviewAdminListReviews { atr_id?, visible?, page, limit }`, `reviewSetReviewVisible` (aprobar las anónimas) |
| Cupones y acuerdo B2B | `couponListCoupons`, `couponCreateCoupon`, `couponGetCoupon`, `couponUpdateCoupon`; `couponGetAgreement`, `couponUpdateAgreement` (descuento de paquetes de Booking) |
| Mensajes de contacto | `supportListMessages { leido?, page, limit }`, `supportSetMessageRead` |
| Facturación electrónica | `invoicingListInvoices`, `invoicingGetInvoice` (estado SRI, clave de acceso) |
| Clientes API (socios) | `identityListApiClients`, `identityCreateApiClient { codigo, nombre }` (la `api_key` se muestra **una sola vez**), `identitySetApiClientActive` |

### 2.8 Acceso y navegación

| Tema | Detalle |
|---|---|
| Ruta `/admin` | Ya se protege con el rol `ADMIN` (`ProtectedRoute role="ADMIN"`) |
| `OPERADOR` y `GUIA` | **No tienen panel propio.** Los operadores se registran en Catalog y pueden vincularse a un usuario (§4.2). Los guías se administran desde la sección Guías del panel (§2.9) y **no necesitan cuenta**. Quien tenga usuario con rol `OPERADOR` o `GUIA` solo conserva el check-in (`/admin/checkin`) |
| `ADMIN_SECTIONS` | Añadir Usuarios, Guías, Reseñas, Cupones, Mensajes, Facturas y Socios; quitar los enlaces a pantallas que no existan |
| Errores | Usar `ApiError` (`extensions.reason`), igual que el portal. Códigos propios del panel: `CANNOT_DISABLE_SELF`, `ROLE_ALREADY_ASSIGNED`, `ROLE_NOT_ASSIGNED`, `USER_NOT_FOUND`, `CANCELLATION_DEADLINE_PASSED` (no aplica a `ADMIN`) |

### 2.9 Guías (sección nueva: `/admin/guias`)

Un guía es una ficha de ms-catalog (tabla `guia`) que pertenece a un operador. **No necesita cuenta en el sistema**:
`usu_id` es opcional («Puede no tener cuenta en el sistema», `Plan/ms_catalog/ms_catalog.sql`). El panel no tiene hoy
ninguna pantalla de guías.

| Función | Operación | Datos |
|---|---|---|
| Listar | `catalogListGuides { operador?, activo? }` | Código, nombre, credencial MINTUR, operador, activo y usuario vinculado (si tiene) |
| Ver | `catalogGetGuide { codigo }` | |
| Crear | `catalogCreateGuide { codigo, nombre, credencial_mintur, operador, usu_id? }` | `codigo` único (por ejemplo `GUIA-CARLOS-01`) y `operador` = código del operador (selector con `catalogListOperators`). `usu_id` se deja vacío para un guía sin cuenta |
| Editar | `catalogUpdateGuide { codigo, nombre?, credencial_mintur?, usu_id? }` | Vincular o desvincular una cuenta (`usu_id: null`) |
| Activar / desactivar | `catalogUpdateGuide { codigo, activo }` | Un guía inactivo deja de asignarse a reservas nuevas |

Cómo se usa el guía en el resto del sistema:

| Momento | Comportamiento actual |
|---|---|
| Compra | Catalog asigna a la reserva el **primer guía activo del operador** de la atracción (`guides.forReservation`, el de menor `gui_id`). Booking guarda su `gui_id` y muestra su nombre en `guia_asignado` |
| Check-in | Lo registra un `ADMIN`, un `OPERADOR` o un `GUIA` con cuenta. `guia_codigo` identifica al guía que valida, tenga cuenta o no: un guía sin cuenta queda registrado por su código aunque el check-in lo haga otra persona |
| Reservas del panel | Columna «Guía» con `guia_asignado` |

Decisión pendiente (§5): no hay asignación por atracción, fecha ni turno. Con un solo guía activo por operador basta;
con varios, todas las reservas recaen en el primero.

---

## 3. Tipos que cambian

| Archivo | Hoy | Debe quedar |
|---|---|---|
| `api/admin.ts` | `AdminSummary`, `AdminCustomer`, `AdminReservation`, `AdminOrder`, `AdminPayment`, `AdminSlot`, `AdminRole`, `SalesReport`, `Observability`, `PagedResponse` | Borrar y usar los tipos de cada servicio: `User` y `RoleName` (identity), `Reservation` (booking), `OrderSummary`/`OrderDetail`, `Invoice`, más los que faltan: `Payment`, `Refund`, `Slot`, `Schedule`, `BlockedDate`, `PriceTable`, `AdminAttraction`, `Operator`, `Guide`, `Coupon`, `AuditEntry`, `SystemHealth`, `ApiClient` |
| `pages/admin/legacy.ts` | Atracción del monolito y su formulario | Borrar al terminar |
| `AdminTable.tsx` | `load(params) → PagedResponse` con `offset` | Adaptador `{ page, limit } → { total, items }`: Identity, Payment, Audit y Catalog usan `metadata` + `data`; Booking y Order, `total_results` + `items`; Review y Support, `data` + `pagination` |
| `StatusBadge.tsx` | Mezcla estados viejos y nuevos | Dejar solo los estados de los servicios |

---

## 4. Gestión de usuarios (nuevo)

La sección `Usuarios` (`/admin/usuarios`) reemplaza a `AdminCustomersPage` y trabaja solo con ms-identity.

### 4.1 Listado y detalle

| Función | Operación |
|---|---|
| Buscar y filtrar | `identityListUsers { q?, rol?, activo?, page, limit≤100 }` → `{ metadata, data: User[] }`. `q` busca en nombre, apellido y correo |
| Ver detalle | `identityGetUser { id }`: datos, `verificado`, `activo`, `roles`, `ultimo_acceso` y `creado_en` |
| Datos vinculados (pestañas del detalle) | Reservas y órdenes del usuario: no hay filtro por usuario en Booking ni Order (decisión §5). Bitácora: `auditListEntries { usu_id }`. Reseñas: `reviewAdminListReviews` |
| Roles disponibles | `identityListRoles` (`ADMIN`, `OPERADOR`, `GUIA`, `CLIENTE`, con su descripción) |

### 4.2 Activar, desactivar y roles

| Acción | Operación | Reglas del servidor |
|---|---|---|
| Desactivar / reactivar | `identitySetUserActive { id, activo }` | Desactivar revoca todas sus sesiones. Un `ADMIN` no puede desactivarse a sí mismo (`CANNOT_DISABLE_SELF`) |
| **Hacer administrador** | `identityAssignRole { id, rol: 'ADMIN' }` | Error `ROLE_ALREADY_ASSIGNED` si ya lo tiene. Identity guarda quién lo asignó |
| Dar rol de operador | `identityAssignRole { id, rol: 'OPERADOR' }` y luego `catalogLinkOperatorUser { codigo, usuId, cargo }` | Sin el vínculo, el rol no le da acceso a ninguna atracción |
| Dar acceso a un guía (opcional) | Solo si el guía va a hacer el check-in con su propia cuenta: `identityAssignRole { id, rol: 'GUIA' }` y, en la sección Guías, `catalogUpdateGuide { codigo, usu_id }` | Un guía sin cuenta se administra igual (§2.9) |
| Quitar un rol | `identityRemoveRole { id, rol }` | `ROLE_NOT_ASSIGNED` si no lo tenía. **No protege al último administrador** (§4.4) |

La interfaz debe pedir confirmación antes de dar o quitar `ADMIN`, mostrar los roles como interruptores y avisar que
el cambio rige desde el próximo token: el Gateway guarda en caché la validación unos 30 s (`TOKEN_CACHE_MS`).

### 4.3 Crear usuarios desde el panel

ms-identity no tiene `POST /usuarios` para administradores (el contrato `Plan/ms_identity/ms_identity-openapi.yaml` no lo
define). Hay dos caminos:

| Opción | Cómo | Ventajas | Inconvenientes |
|---|---|---|---|
| **A. Sin cambios en el backend (recomendada para empezar)** | El panel llama a `POST /api/v3/auth/registro` con correo, nombre, apellido y una contraseña temporal; luego `identityAssignRole` con los roles elegidos | Funciona hoy; no toca el contrato. Registrar no abre sesión, así que no afecta la del administrador | La cuenta queda sin verificar y recibe el correo de verificación. La contraseña temporal hay que comunicarla aparte, o la persona usa "¿Olvidaste tu contraseña?". El registro tiene el límite de solicitudes del Gateway |
| B. Endpoint nuevo en Identity | `POST /usuarios` (rol `ADMIN`): crea la cuenta verificada, con roles y sin contraseña, y envía el enlace de "crear contraseña" (el mismo token de recuperación) | Flujo limpio, sin contraseñas temporales; queda auditado como alta administrativa | Extiende el contrato de ms-identity, la ruta del ESB (`identity.createUser`) y GraphQL (`identityCreateUser`) |

Ya existe `tools/create-admin.mjs` para el **primer** administrador (`createFirstAdmin`, solo si no hay ninguno). Los
siguientes administradores se crean con el panel (opción A o B) o promoviendo un usuario existente (§4.2).

### 4.4 Cambios necesarios en ms-identity

| Cambio | Motivo |
|---|---|
| ✅ **Hecho:** `removeRole` rechaza quitarse el propio `ADMIN` (409 `CANNOT_REMOVE_OWN_ADMIN`, documentado en el OpenAPI de ms-identity) | Un administrador perdía el acceso al panel con un clic |
| No hace falta proteger "el último administrador" | Quitarse el propio `ADMIN` y desactivarse a sí mismo (`CANNOT_DISABLE_SELF`) ya están bloqueados, y quien hace el cambio es administrador: el sistema nunca queda sin `ADMIN` |
| Revocar las sesiones al quitar `ADMIN`, `OPERADOR` o `GUIA` | El token vigente conserva los roles hasta vencer |
| ✅ **Hecho:** registrar en la bitácora los cambios de roles, cuentas y socios | [PLAN_BITACORA_IDENTITY.md](PLAN_BITACORA_IDENTITY.md): ms-identity publica `ROL_ASIGNADO`, `ROL_REVOCADO`, `USUARIO_DESACTIVADO`/`REACTIVADO`, `ADMIN_INICIAL_CREADO` y `CLIENTE_API_*` por su `outbox`; ms-audit los guarda. Falta la pestaña Historial del panel |
| (Opción B) `POST /usuarios` | §4.3 |

### 4.5 Turistas de socios

Los turistas que registra Booking (`cliente_api` con tipo `TURISTA`, `GET/POST /clientes`) no tienen operación GraphQL.
Para verlos en el panel hay que añadir `identity.findClients` al ESB y `q('identity','findClients')` a GraphQL. Son
contactos de reservas de socios, no cuentas que inician sesión: van en una pestaña aparte de Usuarios.

---

## 5. Decisiones pendientes

| Tema | Propuesta |
|---|---|
| Tablero y reportes sin agregados | Empezar calculando en el panel (§2.1 y §2.5). Si es lento, añadir `ListOrdersRequest.desde/hasta` y un `OrderStats` en ms-order |
| Reservas y órdenes por usuario | Añadir `usu_id` como filtro de `ListOrders` (solo `ADMIN`) |
| Alta de usuarios | Opción A ya; opción B si se quiere evitar contraseñas temporales |
| Reparto de guías | Hoy, el primer guía activo del operador. Si un operador tiene varios guías, añadir en ms-catalog la asignación por atracción (tabla `atraccion_guia`) o la elección del guía al crear el horario en ms-inventory |

---

## 6. Cambios propuestos (por prioridad)

1. **Cliente y tipos:** reescribir `src/api/admin.ts` sobre GraphQL, borrar `legacy.ts` y adaptar `AdminTable` a la paginación por página.
2. **Usuarios:** nueva sección con listado, filtros, detalle, activar/desactivar, roles (incluido hacer administrador) y alta (opción A).
   En paralelo, las protecciones de ms-identity de §4.4.
3. **Operaciones:** reservas, órdenes, pagos y reembolsos con los estados nuevos; cancelación como `ADMIN` por Booking.
4. **Catálogo:** editor de atracción de ms-catalog con pestañas de tarifas (ms-pricing) y horarios (ms-inventory); operadores y categorías.
   **Guías** como sección propia del panel (§2.9).
5. **Disponibilidad:** turnos, horarios, cierres y días bloqueados.
6. **Tablero, reportes y observabilidad:** contadores por `total_results`, `systemHealth` y bitácora de ms-audit.
7. **Módulos nuevos:** reseñas, cupones y acuerdo B2B, mensajes, facturas y socios (clientes API).
8. **Bitácora de Identity:** según [PLAN_BITACORA_IDENTITY.md](PLAN_BITACORA_IDENTITY.md), y la pestaña Historial en el detalle de cada usuario.
