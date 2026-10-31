# AtraccionesService-web · TourGirls

Portal web para descubrir y reservar atracciones de Ecuador. React 19 + TypeScript + Vite + Tailwind CSS 3,
con el diseño de las páginas de destino de Viator y la paleta rosada del plan
([PLAN_IMPLEMENTACION_WEB.md](../PLAN_IMPLEMENTACION_WEB.md)).

## Puesta en marcha

Todo el entorno (PostgreSQL, autenticación, API y web) se arranca desde la raíz con `start-local.cmd`
(ver el [README principal](../README.md)).

Solo el frontend: `npm install && npm run dev` (usa `.env.development`; para otros valores copia `.env.example` a `.env.local`).

| Variable | Uso |
|---|---|
| `VITE_API_URL` | URL del API sin `/api/v1` |
| `VITE_AUTH_URL` | Servicio de autenticación (registro e inicio de sesión) |
| `VITE_CATALOG_SOURCE` | `auto` (por defecto) o `api`: catálogo del API; `demo`: catálogo local sin backend |

| Script | Uso |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Comprobación de tipos y build de producción en `dist/` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unitarias y de componentes) |

## Catálogo y autenticación

- La lectura del catálogo y de la disponibilidad es pública en el API, así que con `VITE_CATALOG_SOURCE=auto` (o `api`)
  la web muestra siempre los datos de PostgreSQL, con o sin sesión. Con `demo` usa el catálogo local
  (`src/features/attractions/demoCatalog.ts`) para trabajar en la web sin el backend.
- Registro e inicio de sesión con formularios propios (`/registro`, `/login`) contra el servicio de autenticación, que
  devuelve un JWT. El token vive solo en memoria: recargar la pestaña cierra la sesión.
- Reservas, compras, pedidos y pagos siempre usan el API, con `Idempotency-Key` por intento lógico de mutación.

## Estructura

```
src/
  api/          clientes HTTP por recurso (client.ts centraliza token, errores e idempotencia)
  app/          router, layout y rutas
  components/   common, layout, attractions, search, reservation, purchase, profile, ui
  features/     auth (sesión, rutas protegidas), attractions (filtros, catálogo), content
  hooks/        useAuth, useAttractions, useReservations, usePurchase, usePagination, useAsync
  pages/        una carpeta por página; AuthPages (login/registro); admin/ agrupa el área administrativa
  stores/       Zustand: auth, compra, UI, pedidos recientes
  styles/       tokens, globales y componentes
  utils/        formato, fechas, validación (zod), errores, idempotencia
```

## Docker

```bash
docker build -t tourgirls-web --build-arg VITE_API_URL=https://tourgirls-api.azurewebsites.net \
  --build-arg VITE_AUTH_URL=https://tourgirls-auth.azurewebsites.net .
docker run -p 8080:80 tourgirls-web
```

Fotografías de demostración: Wikimedia Commons (CC BY, CC BY-SA, CC0 y dominio público).
