# AtraccionesService-web · TourGirls

Portal web para descubrir y comprar atracciones de Ecuador. React 19 + TypeScript + Vite + Tailwind CSS 3.
Habla **solo con el Gateway** del sistema de microservicios; no tiene datos escritos en el código.

## Puesta en marcha

Arranca los microservicios y el Gateway (`start-microservices.ps1`, ver el [README principal](../README.md)) y luego:

```bash
npm install
npm run dev        # usa .env.development → Gateway en http://localhost:3000
```

| Variable | Uso |
|---|---|
| `VITE_API_URL` | URL del Gateway, sin prefijo. El cliente añade `/api/v3` (REST) y `/graphql` |

En producción (`.env.production`) apunta a `https://tourgirls-gateway-mm.azurewebsites.net`. El Gateway debe tener el
origen de la web en `CORS_ORIGINS`, e Identity la URL de la web en `PORTAL_URL` (enlaces de los correos).

| Script | Uso |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Comprobación de tipos y build de producción en `dist/` |
| `npm run lint` | ESLint |

## Qué consume del backend

| Parte | Vía | Operaciones |
|---|---|---|
| Sesión | REST `/api/v3/auth/*` (ms-identity) | `login`, `registro`, `refresh`, `logout`, `recuperacion`, `verificacion-correo` |
| Catálogo público (contrato v3) | REST `/api/v3/atracciones/*` (Partner API) | `search`, `/{id}`, `/{id}/disponibilidad`, `categorias` |
| Perfil | GraphQL | `identityGetMe`, `identityUpdateMe`, `identityChangePassword` |
| Ciudades e idiomas | GraphQL | `locationListCities`, `catalogListLanguages` |
| Compra | GraphQL | `bookingCreateReservation` (orden, cupos y pago en un paso), `paymentListMethods`, `couponValidateCoupon` |
| Reservas | GraphQL | `bookingListReservations`, `bookingGetReservation`, `bookingCancelReservation`, `orderGetOrder`, `invoicingGetOrderInvoice` |
| Facturación | GraphQL | `billingListProfiles`, `billingCreateProfile`, `billingReplaceProfile`, `billingDeleteProfile`, `billingMarkPrincipal` |
| Reseñas | GraphQL | `reviewListReviews`, `reviewCreateReview` |
| Contacto | GraphQL | `supportSendMessage` |

- El token de acceso y el refresh token viven solo en memoria: recargar la pestaña cierra la sesión. Antes de vencer
  (o ante un 401) el token se renueva con `/auth/refresh` sin pedir la contraseña.
- Los permisos de la interfaz salen de `usuario.roles` (`ADMIN`, `OPERADOR`, `GUIA`, `CLIENTE`); el servidor autoriza.
- Errores: ProblemDetails (`code`, `invalid_params`) en REST y `errors[].extensions.reason` en GraphQL, unificados en
  `ApiError` (`src/utils/api.ts`).
- Compra y cancelación envían `idempotencyKey` (UUID por intento lógico, reutilizado en reintentos).

## Estructura

```
src/
  api/          un módulo por servicio; client.ts tiene los clientes REST y GraphQL (token, renovación, errores)
  app/          router, layout y rutas
  components/   common, layout, attractions, search, reservation, purchase, profile, ui
  features/     auth (sesión, rutas protegidas), attractions (filtros, selección de compra), content (FAQ, fotos de portada)
  hooks/        useAuth, useAttractions, useReservations, usePagination, useAsync
  pages/        una carpeta por página; AuthPages (acceso y recuperación); admin/ es el panel (auditoría aparte)
  stores/       Zustand: sesión y UI
  utils/        formato, fechas, validación (zod), errores, idempotencia
```

El panel administrativo (`src/pages/admin`) aún usa endpoints del monolito anterior (`pages/admin/legacy.ts`,
`api/admin.ts`), salvo el check-in; tiene su propia auditoría pendiente.

## Docker

```bash
docker build -t tourgirls-web --build-arg VITE_API_URL=https://tourgirls-gateway-mm.azurewebsites.net .
docker run -p 8080:80 tourgirls-web
```
