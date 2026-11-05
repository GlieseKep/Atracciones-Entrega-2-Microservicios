# Auditoría del frontend · AtraccionesService-web

| | |
|---|---|
| Fecha | 2026-11-01 |
| Alcance | Portal público: inicio, listado, detalle, búsqueda, reserva, compra, pedido, perfil, ayuda, login y registro |
| Fuera de alcance | Panel administrativo (`src/pages/admin/*`, `src/api/admin.ts`): se revisa después |
| Backend de referencia | Gateway `https://tourgirls-gateway-mm.azurewebsites.net` (Partner API v3, `/api/v3/auth/**` y `/graphql`) |

## 1. Resumen

El portal se escribió para el **monolito anterior** (`/api/v1`) y su servicio de autenticación (`dev-auth`). Ninguno de los dos
existe ya: se borraron en la Parte 1 de `PLAN_DESPLIEGUE_UNA_APP.md`. Por eso:

1. **Ninguna llamada llega al backend nuevo.** `.env.production` apunta a `tourgirls-api-mms` y `tourgirls-auth-mms`, que ya no
   existen, con el prefijo `/api/v1`.
2. **Lo que se ve "con datos" es contenido escrito en el código.** El inicio arma destinos, recomendaciones, testimonios e ideas
   de viaje con el catálogo de demostración (`demoCatalog.ts`). Esas tarjetas usan identificadores inventados
   (`a1b2c3d4-0001-…`, `de000000-0005-…`) que no existen en `ms_catalog`, así que al hacer clic el detalle no encuentra la
   atracción.
3. **Los tipos de datos son los del contrato viejo** (`name`, `longDescription`, `price.total`, `locations[]`, `times[]`), no los
   del contrato v3 (`nombre`, `precio` desglosado, `ciudad`, `time_slots[]`). Aunque se cambie la URL, las pantallas no sabrán leer
   las respuestas nuevas.

Corregir solo la URL **no basta**: hay que cambiar la capa `src/api`, los tipos y la sesión.

---

## 2. Referencias al backend anterior

### 2.1 Configuración

| Archivo | Qué tiene | Problema | Debe quedar |
|---|---|---|---|
| [.env.production:3-4](../AtraccionesService-web/.env.production) | `VITE_API_URL=…tourgirls-api-mms…`, `VITE_AUTH_URL=…tourgirls-auth-mms…` | Apps borradas | `VITE_API_URL=https://tourgirls-gateway-mm.azurewebsites.net` y sin `VITE_AUTH_URL` (la sesión va por el Gateway) |
| [src/config/env.ts:18-21](../AtraccionesService-web/src/config/env.ts) | Agrega `/api/v1`; `authUrl` aparte; valores locales `:5276` y `:5280` | Prefijo y puertos del monolito | `/api/v3` y una sola URL base. En local, el Gateway (`:3000`) |
| `.env.development` / `.env.example` | `localhost:5276` y `:5280` | Puertos del monolito | `http://localhost:3000` |
| [README.md](../AtraccionesService-web/README.md) | Describe `start-local.cmd`, el API y `dev-auth` | Documentación del sistema viejo | Actualizar al Gateway y a GraphQL |

### 2.2 Llamadas HTTP (`src/api/*`)

Todas usan rutas del monolito. Con el Gateway nuevo, `/api/v3/*` (salvo `/auth`) va a la **Partner API**, que solo publica el
contrato con Booking. Las operaciones de usuario (perfil, facturación, pedidos, pagos, historial) existen únicamente por
**GraphQL** (`/graphql`).

| Archivo | Llamada actual | Existe en el backend nuevo como |
|---|---|---|
| [api/attractions.ts:13](../AtraccionesService-web/src/api/attractions.ts) | `POST /atracciones/search` (cuerpo `cities`, `rows`, `nextPage`) | `POST /api/v3/atracciones/search` con el cuerpo del contrato v3 (`ciudad`, `page`, `limit`, …) |
| [api/attractions.ts:16](../AtraccionesService-web/src/api/attractions.ts) | `GET /atracciones?limit&offset` | `GET /api/v3/atracciones?page&limit` (arreglo simple) |
| [api/attractions.ts:19](../AtraccionesService-web/src/api/attractions.ts) | `GET /atracciones/{id}` | `GET /api/v3/atracciones/{id}` (`AtraccionDetailResponseV2`) |
| [api/availability.ts:7](../AtraccionesService-web/src/api/availability.ts) | `GET /atracciones/{id}/availability` | `GET /api/v3/atracciones/{id}/disponibilidad?date=` (`time_slots[]`) |
| [api/reservations.ts:5](../AtraccionesService-web/src/api/reservations.ts) | `POST /atracciones/{id}/reservations` | `POST /api/v3/atracciones/reservas`, o GraphQL `bookingCreateReservation` |
| [api/reservations.ts:8](../AtraccionesService-web/src/api/reservations.ts) | `POST /atracciones/reservations/{id}/cancel` | `POST /api/v3/atracciones/reservas/{id}/cancel`, o GraphQL `bookingCancelReservation` |
| [api/reservations.ts:11](../AtraccionesService-web/src/api/reservations.ts) | `GET /atracciones/reservations/{id}` | `GET /api/v3/atracciones/reservas/{id}`, o GraphQL `bookingGetReservation` |
| [api/auth.ts:9-11](../AtraccionesService-web/src/api/auth.ts) | `POST /auth/register` (perfil local), `GET /users/me` | No hay "perfil local": `GET /api/v3/usuarios/me` → GraphQL `identityGetMe` |
| [api/customers.ts:6-8](../AtraccionesService-web/src/api/customers.ts) | `GET/PUT /customers/me` | Facturación: GraphQL `billingListProfiles`, `billingCreateProfile`, `billingReplaceProfile` |
| [api/customers.ts:11](../AtraccionesService-web/src/api/customers.ts) | `GET /customers/me/reservations` | GraphQL `bookingListReservations` |
| [api/orders.ts:4](../AtraccionesService-web/src/api/orders.ts) | `GET /orders/{id}` | GraphQL `orderGetOrder` |
| [api/orders.ts:7](../AtraccionesService-web/src/api/orders.ts) | `GET /orders/{id}/events` | **No existe.** Lo más cercano: bitácora por `correlation_id` (solo ADMIN) o el estado de la orden |
| [api/orders.ts:10](../AtraccionesService-web/src/api/orders.ts) | `POST /orders/{id}/cancel` | GraphQL `orderCancelOrder` |
| [api/purchases.ts:6](../AtraccionesService-web/src/api/purchases.ts) | `POST /attractions/{id}/purchase` | GraphQL `bookingCreateReservation` (Booking orquesta orden, cupos y pago) |
| [api/payments.ts:6](../AtraccionesService-web/src/api/payments.ts) | `POST /payments/simulations` | El pago va dentro de la compra (`payment_method` y `tarjeta`); consulta: GraphQL `paymentGetPayment` |

### 2.3 Sesión

| Archivo | Qué hace | Problema |
|---|---|---|
| [features/auth/session.ts:32-53](../AtraccionesService-web/src/features/auth/session.ts) | `POST {authUrl}/auth/login` con `{ email, password }` y `/auth/register` con `{ name, email, password }`; espera `{ access_token, user }` | ms-identity usa `POST /api/v3/auth/login` con `{ correo, password }`, `POST /api/v3/auth/registro` con `{ correo, password, nombre, apellido, … }`, y responde `{ access_token, refresh_token, usuario }` |
| [features/auth/session.ts:71-85](../AtraccionesService-web/src/features/auth/session.ts) (`claimsFrom`) | Lee `scope`, `email` y `name` del JWT | El JWT de ms-identity solo trae `sub`, `sid` y `roles`: el perfil queda sin nombre ni correo, y los permisos vacíos |
| [api/auth.ts:15-23](../AtraccionesService-web/src/api/auth.ts) (`ensureProfile`) | Crea un "perfil local" en el primer inicio de sesión | Ese concepto ya no existe: el usuario se crea al registrarse en ms-identity |
| [stores/authStore.ts](../AtraccionesService-web/src/stores/authStore.ts) | Token solo en memoria; recargar cierra la sesión | Se mantiene válido, pero ms-identity entrega `refresh_token` y `POST /api/v3/auth/refresh`: se podría renovar sin pedir otra vez la contraseña |
| [api/admin.ts:16](../AtraccionesService-web/src/api/admin.ts) (`ADMIN_SCOPE = 'attractions:write'`) | El login y la barra de navegación deciden si es administrador por ese scope | Los roles nuevos son `ADMIN`, `OPERADOR`, … en `roles`. Afecta al login y al menú aunque el panel quede para después |

---

## 3. Contenido escrito en el código

| Archivo | Contenido | Efecto en pantalla |
|---|---|---|
| [features/attractions/demoCatalog.ts](../AtraccionesService-web/src/features/attractions/demoCatalog.ts) | 10 atracciones inventadas con ids `a1b2c3d4-…` y `de000000-…`, precios, valoraciones (`1250 opiniones`, `4.6`), operador `Quito Tours (ejemplo)` y fotos de Wikimedia | Base de casi todo el contenido "con datos" del inicio |
| [features/attractions/catalogService.ts:30,55,67-90](../AtraccionesService-web/src/features/attractions/catalogService.ts) | Si `VITE_CATALOG_SOURCE=demo`, usa `DEMO_ATTRACTIONS` y `demoAvailability` (horarios 09:00 y 14:00 calculados con un hash) | Disponibilidad falsa si se activa el modo demo |
| [features/content/homeContent.ts:7-14](../AtraccionesService-web/src/features/content/homeContent.ts) (`DESTINATIONS`) | 6 destinos con fotos del demo y textos fijos | Se ven siempre; el número de experiencias cae al texto fijo cuando el catálogo falla |
| [features/content/homeContent.ts:16-22](../AtraccionesService-web/src/features/content/homeContent.ts) (`QUICK_CATEGORIES`) | `Naturaleza`, `Aventura`, `Cultura`, `Gastronomía`, `Fotografía` | No coinciden con las categorías de ms-catalog (`Aventura`, `Cultural`, `Naturales`, `Gastronomia`, `Playas`, `Montana`): filtros que no devuelven nada |
| [features/content/homeContent.ts:24-43](../AtraccionesService-web/src/features/content/homeContent.ts) (`AUDIENCES`) | "Para parejas", "En familia", "Para fotógrafos" con listas de ids del demo | **Causa del clic roto**: si el catálogo real no trae esos ids (nunca los trae), la sección cae a otras atracciones; si el catálogo no carga, no hay tarjetas válidas |
| [features/content/homeContent.ts:52-83](../AtraccionesService-web/src/features/content/homeContent.ts) (`TESTIMONIALS`) | 3 testimonios inventados | Reseñas falsas; ms-review tiene reseñas reales (`reviewListReviews`) |
| [features/content/homeContent.ts:85-110](../AtraccionesService-web/src/features/content/homeContent.ts) (`STORIES`) | 3 "ideas de viaje" con filtros `categorias=Aventura`, `ciudad=Baños de Agua Santa` | Llevan a listados vacíos (categoría y ciudad no existen con esos nombres) |
| [features/content/homeContent.ts:112-127](../AtraccionesService-web/src/features/content/homeContent.ts) (`FAQ`) | Habla de "Reservar ahora, pagar después" y "Comprar y pagar ahora" | El flujo nuevo es una sola compra orquestada por Booking: hay que reescribir esas respuestas |
| [pages/HomePage/index.tsx:17](../AtraccionesService-web/src/pages/HomePage/index.tsx) | `HERO_PHOTO` del demo | Solo decorativo; puede quedar |
| [pages/AuthPages/index.tsx:71](../AtraccionesService-web/src/pages/AuthPages/index.tsx) | Foto `DEMO_ATTRACTIONS[3]` | Decorativo; puede quedar si se conserva la foto |
| [components/search/SearchBar/index.tsx:8](../AtraccionesService-web/src/components/search/SearchBar/index.tsx) (`KNOWN_CITIES`) | `Quito`, `Latacunga`, `Mindo`, `Baños de Agua Santa`, `Riobamba`, `San Antonio de Pichincha` | ms-location usa `Baños` y no tiene `San Antonio de Pichincha`; faltan Cuenca, Guayaquil, Puerto Ayora, etc. Debe venir de `locationListCities` |
| [components/layout/Footer/index.tsx:48-58](../AtraccionesService-web/src/components/layout/Footer/index.tsx) | `hola@tourgirls.example`, `+593 2 000 0000`, enlace `href="#"` | Contacto ficticio y enlace muerto; el contacto real es ms-support (`supportSendMessage`) |
| [pages/HelpPage/index.tsx:31](../AtraccionesService-web/src/pages/HelpPage/index.tsx) | Mismo correo y teléfono ficticios | Igual que el pie de página; falta un formulario de contacto |
| [features/attractions/filters.ts](../AtraccionesService-web/src/features/attractions/filters.ts) (`DURATION_OPTIONS`, idiomas, valoración) | Filtros calculados en el cliente | Válidos, pero duplican filtros que ya hace `POST /atracciones/search` |

---

## 4. Por qué el clic en una atracción no lleva a una válida

1. El inicio pinta tarjetas con `DESTINATIONS`, `AUDIENCES` y `STORIES`, que dependen del catálogo de demostración.
2. El catálogo real se pide a `tourgirls-api-mms/api/v1/atracciones/search`, que ya no existe: la llamada falla.
3. `AUDIENCES` busca ids del demo (`de000000-0005-…`) dentro del catálogo real; nunca coinciden, porque ms-catalog usa códigos de
   12 caracteres como `3GdwkIAEDKjp`.
4. Al abrir `/atracciones/{id}`, `fetchAttraction` vuelve a llamar al API viejo y termina en error o en "no encontrado".

Aunque se corrija la URL, el paso 3 seguiría fallando: los ids escritos en el código no existen en `ms_catalog`.

---

## 5. Diferencias de formato con el contrato v3

| Dato | Frontend espera (`types/attraction.ts`) | v3 devuelve |
|---|---|---|
| Nombre | `name` | `name` y `nombre` |
| Descripción | `longDescription` | `description` / `descripcion`; en tarjetas `short_description` |
| Precio | `price: { currency, total }` | `price` / `precio`: tarifa desglosada (`adult`, `child`, `senior`, `infant`, `currency`) |
| Ubicación | `locations[]` con `city` y `coordinates` | `city` / `ciudad`, `meeting_point` |
| Duración | ISO 8601 (`PT2H`) | Texto (`7 horas`) y `duration_hours` |
| Categorías | `categories[]` (nombres) | Ids de categoría (`cat-aventura-100`) |
| Valoración | `ratings: { score, numberOfReviews }` | `rating: { score, review_count, badge_text }` |
| Fotos | `photos[].url` | `photos[]` (lista de URL) |
| Listado | `{ data, meta }` o `{ data, metadata.nextPage }` | `GET /atracciones`: arreglo simple. `POST /search`: `{ metadata: { total_results, page, limit, total_pages }, data }` |
| Disponibilidad | `{ date, times[]: { time, availableSpots, status } }` | `{ date, time_slots[]: { slot_id, time, time_24h, available_slots, status } }` |
| Reserva | `{ date, time, ticketCount, customerName, customerEmail }` | `{ attraction_id, slot_id, date, time, adult_count, child_count…, customer: { full_name, email, phone, document_type, document_id }, payment_method }` |
| Estado de reserva | `PENDING`, `CONFIRMED`, `CANCELLED` | `PENDING`, `CONFIRMED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`, `EXPIRED` |

`src/types/order.ts`, `payment.ts`, `purchase.ts` e `identity.ts` siguen el modelo del monolito (pedido con `items[]`, pago simulado
separado, "cliente" local) y tampoco coinciden con ms-order, ms-payment y ms-identity.

---

## 6. Otras inconsistencias

| Tema | Detalle |
|---|---|
| Flujo de compra | El portal tiene dos caminos (reservar sin pagar y comprar en 3 pasos con pago aparte). En el sistema nuevo, Booking hace todo en una llamada: orden, cupos y pago. El paso "Pagar más tarde" y `recentOrdersStore` no tienen equivalente |
| Tipos de boleto | El formulario pide una sola "cantidad". El contrato separa adultos, niños, adultos mayores, estudiantes e infantes, con precio distinto |
| Datos del titular | El formulario pide nombre y correo. El contrato exige además teléfono, tipo y número de documento |
| Errores | `utils/api.ts` reconoce códigos del monolito (`INSUFFICIENT_AVAILABILITY`, `ORDER_HOLD_EXPIRED`…). Los nuevos son `OUT_OF_STOCK`, `SLOT_MISMATCH`, `ALIAS_CONFLICT`, `DATE_IN_PAST`, `ATTRACTION_NOT_FOUND`… |
| Errores en GraphQL | GraphQL responde 200 con `errors[]` y el código en `extensions.reason`; el cliente actual solo entiende RFC 7807 |
| Facturación | El portal guarda un único "cliente". ms-billing-profile maneja varios perfiles con uno principal |
| Favoritos y carrito | ms-cart existe (`cartGetCart`, `cartAddItem`…) y el portal no lo usa |
| Reseñas | ms-review existe (`reviewListReviews`, `reviewCreateReview`) y el detalle solo muestra un número fijo de opiniones |
| Cupones | ms-coupon tiene validación de cupones y el portal no la ofrece |
| Comprobante | ms-invoicing emite la factura y el pedido no la muestra (`invoicingGetOrderInvoice`) |
| Recuperar contraseña y verificar correo | ms-identity los tiene; el portal no tiene esas pantallas |
| Pruebas | `src/test/*` simulan el API viejo; habrá que reescribirlas con el cliente nuevo |
| Marca | El portal dice "TourGirls"; el backend y la documentación, "TourGirls". Decidir un solo nombre |

---

## 7. Cambios propuestos (por prioridad)

1. **Conexión:** `VITE_API_URL` al Gateway, prefijo `/api/v3`, quitar `VITE_AUTH_URL` y `VITE_CATALOG_SOURCE`, y actualizar
   `.env.production`, `.env.development` y el workflow de la Static Web App.
2. **Sesión:** login, registro y renovación con `/api/v3/auth/*`; perfil con `identityGetMe`; roles desde `usuario.roles`, no del JWT.
3. **Catálogo:** tipos nuevos según v3 y adaptadores para listado, detalle, búsqueda y disponibilidad; quitar `demoCatalog.ts` del
   flujo de datos (las fotos decorativas pueden quedar aparte).
4. **Inicio:** destinos, categorías y recomendaciones calculados desde el catálogo real (`locationListCities`, categorías de
   ms-catalog, `destacada`); reseñas desde ms-review; quitar testimonios e ideas con filtros inexistentes.
5. **Compra:** un solo flujo con `bookingCreateReservation`, tipos de boleto separados y datos completos del titular; detalle desde
   `bookingGetReservation` y `orderGetOrder`; factura desde `invoicingGetOrderInvoice`.
6. **Perfil:** historial con `bookingListReservations`; facturación con ms-billing-profile; cambio de contraseña.
7. **Ayuda y pie de página:** formulario de contacto con `supportSendMessage` y datos de contacto reales.
8. **Errores:** códigos nuevos y lectura de `errors[].extensions` de GraphQL.
9. **Pruebas y README** al nuevo backend.
10. **Panel administrativo:** auditoría aparte.
