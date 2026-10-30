/**
 * Rutas del ESB hacia Location (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET) o en el cuerpo.
 */
export interface LocationRestRoute {
  protocol: 'rest';
  target: 'location';
  method: 'GET' | 'POST';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const LOCATION_BASE_PATH = '/api/v3';

const route = (method: LocationRestRoute['method'], path: string, timeoutMs = 2000): LocationRestRoute => ({
  protocol: 'rest', target: 'location', method, path: `${LOCATION_BASE_PATH}${path}`, timeoutMs,
});

export const MS_LOCATION_ROUTES = {
  'location.health': route('GET', '/health', 1000),
  'location.getTree': route('GET', '/regiones'),
  'location.listProvinces': route('GET', '/provincias'),
  'location.getProvince': route('GET', '/provincias/:id'),
  'location.listCities': route('GET', '/ciudades'),
  'location.getCity': route('GET', '/ciudades/:id'),

  // Uso interno (`X-Service-Token`): Catalog y Coupon.
  'location.getCities': route('POST', '/internal/ciudades/lote'),
  'location.resolveCities': route('POST', '/internal/ciudades/resolucion'),
} as const satisfies Record<string, LocationRestRoute>;

export type LocationRouteKey = keyof typeof MS_LOCATION_ROUTES;

/** Nombre de la operación para `EsbClient.call('location', operación)` (`location.getCity` → `getCity`). */
export type LocationOperation = LocationRouteKey extends `location.${infer O}` ? O : never;
