import { jwtVerify, SignJWT } from 'jose';
import { currentContext, newCorrelationId, runWithContext } from './correlation';
import { AppError } from './problem-details';

/** Quién hace la petición, tal como lo autenticó el Gateway (JWT de un usuario o X-API-Key de un socio). */
export interface Principal {
  tipo: 'USUARIO' | 'API_CLIENTE';
  id: string;
  scopes: string[];
  nombre?: string | null;
  email?: string | null;
}

const ISSUER = 'atracciones-gateway';
const AUDIENCE = 'atracciones-internal';
const key = (secret: string) => new TextEncoder().encode(secret);

/**
 * Token interno de vida corta con el principal. Lo firma el Gateway y lo reenvían Partner API, GraphQL y ESB hasta los
 * servicios (cabecera / metadata `x-internal-principal`), que así no dependen de cómo se autenticó el cliente.
 */
export async function signInternalPrincipal(principal: Principal, secret: string, ttlSeconds = 120): Promise<string> {
  return new SignJWT({ tipo: principal.tipo, scopes: principal.scopes, nombre: principal.nombre ?? null, email: principal.email ?? null })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(principal.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}

export async function verifyInternalPrincipal(token: string, secret: string): Promise<Principal> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    const tipo = payload.tipo === 'API_CLIENTE' ? 'API_CLIENTE' : 'USUARIO';
    return {
      tipo,
      id: String(payload.sub),
      scopes: Array.isArray(payload.scopes) ? payload.scopes.map(String) : [],
      nombre: typeof payload.nombre === 'string' ? payload.nombre : null,
      email: typeof payload.email === 'string' ? payload.email : null,
    };
  } catch {
    throw AppError.unauthorized('El principal interno no es válido o expiró.');
  }
}

/** Principal de la petición en curso; `null` si es anónima. */
export async function currentPrincipal(secret: string): Promise<Principal | null> {
  const token = currentContext()?.principalToken;
  return token ? verifyInternalPrincipal(token, secret) : null;
}

/** Igual que `currentPrincipal`, pero exige que exista. */
export async function requirePrincipal(secret: string): Promise<Principal> {
  const principal = await currentPrincipal(secret);
  if (!principal) throw AppError.unauthorized();
  return principal;
}

/**
 * Cuenta de servicio de un componente interno (p. ej. Invoicing al consultar el comprador de una reserva). Tiene el
 * scope de administración; solo se usa entre servicios, nunca llega desde afuera porque el Gateway firma los principales.
 */
export function servicePrincipal(service: string): Principal {
  const hex = Buffer.from(service.padEnd(16, '0').slice(0, 16)).toString('hex');
  return {
    tipo: 'API_CLIENTE',
    id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
    scopes: ['attractions:read', 'attractions:write'],
    nombre: `servicio-${service}`,
  };
}

/**
 * Ejecuta `work` con la cuenta de servicio del componente, conservando el `correlation_id` de la petición en curso (o uno
 * nuevo si no hay). Para lecturas internas que el usuario no podría hacer por sí mismo (p. ej. Order leyendo los pagos de
 * una orden cuyo dueño ya verificó).
 */
export async function asService<T>(service: string, secret: string, work: () => Promise<T>): Promise<T> {
  const context = currentContext();
  const principalToken = await signInternalPrincipal(servicePrincipal(service), secret);
  return runWithContext({ correlationId: context?.correlationId ?? newCorrelationId(), nodeId: context?.nodeId ?? null, principalToken }, work);
}

/**
 * Rol de Identity (`ADMIN`, `OPERADOR`, `CLIENTE`). El Gateway firma el principal interno con los roles que devuelve
 * Identity dentro de `scopes`.
 */
export const hasRole = (principal: Principal | null, role: string) => principal?.scopes.includes(role) ?? false;

export function requireScope(principal: Principal, scope: string): void {
  if (!principal.scopes.includes(scope)) {
    throw AppError.forbidden(`Las credenciales no tienen el permiso '${scope}' requerido para esta operación.`, 'INSUFFICIENT_SCOPE');
  }
}

/** Administración de la tienda: el scope `attractions:write` (rol `admin` o cuenta de servicio). */
export const isAdmin = (principal: Principal | null) => principal?.scopes.includes('attractions:write') ?? false;

export async function requireAdmin(secret: string): Promise<Principal> {
  const principal = await requirePrincipal(secret);
  requireScope(principal, 'attractions:write');
  return principal;
}
