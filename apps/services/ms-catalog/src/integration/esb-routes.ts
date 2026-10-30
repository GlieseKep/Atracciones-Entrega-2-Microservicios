/**
 * Rutas del ESB hacia Catalog (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET/DELETE) o en
 * el cuerpo.
 */
export interface CatalogRestRoute {
  protocol: 'rest';
  target: 'catalog';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const CATALOG_BASE_PATH = '/api/v3';

const route = (method: CatalogRestRoute['method'], path: string, timeoutMs = 3000): CatalogRestRoute => ({
  protocol: 'rest', target: 'catalog', method, path: `${CATALOG_BASE_PATH}${path}`, timeoutMs,
});

export const MS_CATALOG_ROUTES = {
  'catalog.health': route('GET', '/health', 1000),

  // Catálogo público (contrato v3). La búsqueda puede consultar a Location e Inventory.
  'catalog.getCategoryTree': route('GET', '/atracciones/categorias/arbol'),
  'catalog.listCategories': route('GET', '/atracciones/categorias'),
  'catalog.searchAttractions': route('POST', '/atracciones/search', 6000),
  'catalog.listAttractions': route('GET', '/atracciones', 6000),
  'catalog.getAttraction': route('GET', '/atracciones/:id'),

  // Guías.
  'catalog.listGuides': route('GET', '/guias'),
  'catalog.createGuide': route('POST', '/guias'),
  'catalog.getGuide': route('GET', '/guias/:codigo'),
  'catalog.updateGuide': route('PATCH', '/guias/:codigo'),

  // Uso interno (`X-Service-Token`).
  'catalog.getLogistics': route('GET', '/internal/atracciones/:id/logistica'),
  'catalog.getReference': route('GET', '/internal/atracciones/:id/referencia'),

  // Administración.
  'catalog.listOperators': route('GET', '/operadores'),
  'catalog.createOperator': route('POST', '/operadores'),
  'catalog.updateOperator': route('PATCH', '/operadores/:codigo'),
  'catalog.linkOperatorUser': route('POST', '/operadores/:codigo/usuarios'),
  'catalog.unlinkOperatorUser': route('DELETE', '/operadores/:codigo/usuarios/:usuId'),
  'catalog.createCategory': route('POST', '/categorias'),
  'catalog.updateCategory': route('PATCH', '/categorias/:codigo'),
  'catalog.listLanguages': route('GET', '/idiomas'),
  'catalog.listInclusions': route('GET', '/inclusiones'),
  'catalog.createInclusion': route('POST', '/inclusiones'),
  'catalog.adminListAttractions': route('GET', '/admin/atracciones', 6000),
  'catalog.adminCreateAttraction': route('POST', '/admin/atracciones', 6000),
  'catalog.adminGetAttraction': route('GET', '/admin/atracciones/:id'),
  'catalog.adminUpdateAttraction': route('PUT', '/admin/atracciones/:id', 6000),
  'catalog.adminDeleteAttraction': route('DELETE', '/admin/atracciones/:id'),
  'catalog.adminSetAttractionState': route('PUT', '/admin/atracciones/:id/estado'),
} as const satisfies Record<string, CatalogRestRoute>;

export type CatalogRouteKey = keyof typeof MS_CATALOG_ROUTES;

/** Nombre de la operación para `EsbClient.call('catalog', operación)` (`catalog.getGuide` → `getGuide`). */
export type CatalogOperation = CatalogRouteKey extends `catalog.${infer O}` ? O : never;
