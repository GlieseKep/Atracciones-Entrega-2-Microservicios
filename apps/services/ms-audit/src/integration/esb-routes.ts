/**
 * Rutas del ESB hacia Audit (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`.
 */
export interface AuditRestRoute {
  protocol: 'rest';
  target: 'audit';
  method: 'GET';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const AUDIT_BASE_PATH = '/api/v3';

const route = (path: string, timeoutMs = 3000): AuditRestRoute => ({
  protocol: 'rest', target: 'audit', method: 'GET', path: `${AUDIT_BASE_PATH}${path}`, timeoutMs,
});

export const MS_AUDIT_ROUTES = {
  'audit.health': route('/health', 1000),
  'audit.listEntries': route('/bitacora'),
  'audit.listActions': route('/bitacora/acciones'),
} as const satisfies Record<string, AuditRestRoute>;

export type AuditRouteKey = keyof typeof MS_AUDIT_ROUTES;

/** Nombre de la operación para `EsbClient.call('audit', operación)` (`audit.listEntries` → `listEntries`). */
export type AuditOperation = AuditRouteKey extends `audit.${infer O}` ? O : never;
