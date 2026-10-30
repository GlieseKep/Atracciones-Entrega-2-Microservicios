import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import { AppError, EsbClient, type Principal } from '@atracciones/platform';
import type { GatewayConfig } from './config';

/**
 * Autentica la petición (plan D3 y C10): `Authorization: Bearer <JWT RS256 de Identity>` o `X-API-Key` de un socio.
 * Sin credenciales la petición sigue como anónima (las operaciones públicas del contrato no las exigen); con credenciales
 * inválidas responde 401.
 */
export class Authenticator {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly apiKeys = new Map<string, { principal: Principal; until: number }>();

  constructor(
    private readonly config: GatewayConfig,
    private readonly esb: EsbClient,
  ) {
    this.jwks = createRemoteJWKSet(new URL(config.jwt.jwksUrl), { cooldownDuration: 30_000 });
  }

  async authenticate(headers: Record<string, string | string[] | undefined>): Promise<Principal | null> {
    const authorization = typeof headers.authorization === 'string' ? headers.authorization : null;
    const apiKey = typeof headers['x-api-key'] === 'string' ? headers['x-api-key'] : null;
    if (authorization) return this.bearer(authorization);
    if (apiKey) return this.apiKey(apiKey);
    return null;
  }

  private async bearer(header: string): Promise<Principal> {
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw AppError.unauthorized('La cabecera Authorization debe tener el formato "Bearer <token>".');
    try {
      const { payload } = await jwtVerify(match[1], this.jwks, {
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
        algorithms: ['RS256'],
        clockTolerance: 30,
        requiredClaims: ['sub', 'exp'],
      });
      return {
        tipo: 'USUARIO',
        id: String(payload.sub),
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
        nombre: typeof payload.name === 'string' ? payload.name : null,
        email: typeof payload.email === 'string' ? payload.email : null,
      };
    } catch (error) {
      throw AppError.unauthorized(error instanceof joseErrors.JWTExpired ? 'El token JWT expiró.' : 'El token JWT no es válido.');
    }
  }

  /** La clave se valida en Identity (vía ESB) y el resultado se guarda en memoria unos segundos, indexado por su hash. */
  private async apiKey(key: string): Promise<Principal> {
    const id = createHash('sha256').update(key).digest('hex');
    const cached = this.apiKeys.get(id);
    if (cached && cached.until > Date.now()) return cached.principal;
    const principal = await this.esb.call<Principal>('identity', 'verifyApiKey', { api_key: key }, { timeoutMs: 2000 });
    this.apiKeys.set(id, { principal, until: Date.now() + this.config.apiKeyCacheMs });
    return principal;
  }
}
