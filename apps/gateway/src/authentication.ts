import { createHash } from 'node:crypto';
import { AppError, EsbClient, type Principal } from '@atracciones/platform';
import type { GatewayConfig } from './config';

/** Lo que devuelve Identity al validar una credencial (`PrincipalDto` de ms-identity). */
interface IdentityPrincipal {
  tipo: 'USUARIO' | 'CLIENTE_API';
  id: number;
  nombre: string;
  roles: string[];
}

/** Permisos de un socio con `X-API-Key` en el contrato con Booking. Cancelar como `ADMIN` (`attractions:write`) no se concede. */
export const PARTNER_SCOPES = ['attractions:read', 'attractions:book', 'attractions:cancel', 'attractions:checkin', 'clients:read', 'clients:write'];

/**
 * Autentica la petición: `Authorization: Bearer <JWT de ms-identity>` o `X-API-Key` de un socio. Las dos se validan en
 * Identity por el ESB (firma, sesión no revocada, usuario o cliente activo), y el resultado se guarda unos segundos.
 * Sin credenciales la petición sigue como anónima; con credenciales inválidas responde 401.
 */
export class Authenticator {
  private readonly cache = new Map<string, { principal: Principal; until: number }>();

  constructor(
    private readonly config: GatewayConfig,
    private readonly esb: EsbClient,
  ) {}

  async authenticate(headers: Record<string, string | string[] | undefined>): Promise<Principal | null> {
    const authorization = typeof headers.authorization === 'string' ? headers.authorization : null;
    const apiKey = typeof headers['x-api-key'] === 'string' ? headers['x-api-key'] : null;
    if (authorization) {
      const match = /^Bearer\s+(\S+)$/i.exec(authorization);
      if (!match) throw AppError.unauthorized('La cabecera Authorization debe tener el formato "Bearer <token>".');
      return this.validate('validateToken', { token: match[1] }, this.config.tokenCacheMs);
    }
    if (apiKey) return this.validate('validateApiKey', { api_key: apiKey }, this.config.apiKeyCacheMs);
    return null;
  }

  private async validate(operation: 'validateToken' | 'validateApiKey', input: Record<string, string>, ttlMs: number): Promise<Principal> {
    const id = createHash('sha256').update(`${operation}:${Object.values(input)[0]}`).digest('hex');
    const cached = this.cache.get(id);
    if (cached && cached.until > Date.now()) return cached.principal;
    const principal = toPrincipal(await this.esb.call<IdentityPrincipal>('identity', operation, input, { timeoutMs: 3000 }));
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(id, { principal, until: Date.now() + ttlMs });
    return principal;
  }
}

/** Principal interno: el `usu_id` numérico como texto y los roles de Identity en `scopes`. */
function toPrincipal(p: IdentityPrincipal): Principal {
  return p.tipo === 'CLIENTE_API'
    ? { tipo: 'API_CLIENTE', id: String(p.id), scopes: PARTNER_SCOPES, nombre: p.nombre, email: null }
    : { tipo: 'USUARIO', id: String(p.id), scopes: p.roles, nombre: p.nombre, email: null };
}
