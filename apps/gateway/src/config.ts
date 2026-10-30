export interface GatewayConfig {
  port: number;
  upstreams: {
    partnerApi: string;
    identity: string;
    esb: string;
    /** Monolito del portal (prefijo provisional /internal/web, plan §7.7). */
    monolith: string | null;
    graphql: string | null;
  };
  jwt: { jwksUrl: string; issuer: string; audience: string };
  internalTokenSecret: string;
  corsOrigins: string[];
  /** Solicitudes por minuto y por IP en las rutas que no son del contrato (/graphql, /internal/web, /auth). */
  rateLimitPerMinute: number;
  apiKeyCacheMs: number;
}

const list = (value: string | undefined) => (value ?? '').split(',').map((v) => v.trim().replace(/\/$/, '')).filter(Boolean);

export function readGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const secret = env.INTERNAL_TOKEN_SECRET ?? '';
  if (secret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  const identity = env.IDENTITY_URL ?? 'http://127.0.0.1:4001';
  return {
    port: Number(env.PORT ?? 3000),
    upstreams: {
      partnerApi: env.PARTNER_API_URL ?? 'http://127.0.0.1:3100',
      identity,
      esb: env.ESB_URL ?? 'http://127.0.0.1:3300',
      monolith: env.MONOLITH_URL ?? 'http://127.0.0.1:5276',
      graphql: env.GRAPHQL_URL ?? null,
    },
    jwt: {
      jwksUrl: env.JWKS_URL ?? `${identity}/.well-known/jwks.json`,
      issuer: env.JWT_ISSUER ?? 'atracciones-identity',
      audience: env.JWT_AUDIENCE ?? 'atracciones-api',
    },
    internalTokenSecret: secret,
    corsOrigins: list(env.CORS_ORIGINS),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 300),
    apiKeyCacheMs: Number(env.API_KEY_CACHE_MS ?? 60_000),
  };
}
