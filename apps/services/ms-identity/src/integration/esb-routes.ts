/**
 * Rutas del ESB hacia Identity (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET/DELETE) o en
 * el cuerpo.
 */
export interface IdentityRestRoute {
  protocol: 'rest';
  target: 'identity';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const IDENTITY_BASE_PATH = '/api/v3';

const route = (method: IdentityRestRoute['method'], path: string, timeoutMs = 3000): IdentityRestRoute => ({
  protocol: 'rest', target: 'identity', method, path: `${IDENTITY_BASE_PATH}${path}`, timeoutMs,
});

export const MS_IDENTITY_ROUTES = {
  'identity.health': route('GET', '/health', 1000),

  // Autenticación. bcrypt tarda, por eso los plazos son mayores.
  'identity.register': route('POST', '/auth/registro', 5000),
  'identity.login': route('POST', '/auth/login', 5000),
  'identity.refresh': route('POST', '/auth/refresh'),
  'identity.logout': route('POST', '/auth/logout'),
  'identity.verifyEmail': route('POST', '/auth/verificacion-correo'),
  'identity.resendVerification': route('POST', '/auth/verificacion-correo/reenvio'),
  'identity.requestRecovery': route('POST', '/auth/recuperacion', 5000),
  'identity.confirmRecovery': route('POST', '/auth/recuperacion/confirmar', 5000),

  // Perfil.
  'identity.getMe': route('GET', '/usuarios/me'),
  'identity.updateMe': route('PATCH', '/usuarios/me'),
  'identity.changePassword': route('PUT', '/usuarios/me/password', 5000),

  // Administración (rol ADMIN).
  'identity.listUsers': route('GET', '/usuarios'),
  'identity.getUser': route('GET', '/usuarios/:id'),
  'identity.setUserActive': route('PUT', '/usuarios/:id/activo'),
  'identity.assignRole': route('POST', '/usuarios/:id/roles'),
  'identity.removeRole': route('DELETE', '/usuarios/:id/roles/:rol'),
  'identity.listRoles': route('GET', '/roles'),
  'identity.listApiClients': route('GET', '/clientes-api'),
  'identity.createApiClient': route('POST', '/clientes-api'),
  'identity.setApiClientActive': route('PUT', '/clientes-api/:id/activo'),

  // Clientes turistas que registra un socio (Booking) o un ADMIN. Registrar llama a Billing: plazo mayor.
  'identity.findClient': route('GET', '/clientes'),
  'identity.createClient': route('POST', '/clientes', 6000),

  // Uso interno (`X-Service-Token`).
  'identity.ensureClient': route('POST', '/internal/clientes', 6000),
  'identity.validateToken': route('POST', '/internal/tokens/validar', 1500),
  'identity.validateApiKey': route('POST', '/internal/api-keys/validar', 1500),
  'identity.getUsers': route('POST', '/internal/usuarios/lote'),
} as const satisfies Record<string, IdentityRestRoute>;

export type IdentityRouteKey = keyof typeof MS_IDENTITY_ROUTES;

/** Nombre de la operación para `EsbClient.call('identity', operación)` (`identity.getMe` → `getMe`). */
export type IdentityOperation = IdentityRouteKey extends `identity.${infer O}` ? O : never;
