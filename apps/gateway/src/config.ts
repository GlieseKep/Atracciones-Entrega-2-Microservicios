export interface GatewayConfig {
  port: number;
  upstreams: {
    partnerApi: string;
    identity: string;
    esb: string;
    graphql: string | null;
  };
  internalTokenSecret: string;
  corsOrigins: string[];
  /** Solicitudes por minuto y por IP fuera del contrato con Booking (/graphql y /api/v3/auth). */
  rateLimitPerMinute: number;
  apiKeyCacheMs: number;
  tokenCacheMs: number;
}

const list = (value: string | undefined) => (value ?? '').split(',').map((v) => v.trim().replace(/\/$/, '')).filter(Boolean);

export function readGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  for (const name of ['INTERNAL_TOKEN_SECRET', 'SERVICE_TOKEN']) {
    if ((env[name] ?? '').length < 32) throw new Error(`${name} debe tener al menos 32 caracteres.`);
  }
  return {
    port: Number(env.PORT ?? 3000),
    upstreams: {
      partnerApi: env.PARTNER_API_URL ?? 'http://127.0.0.1:3100',
      identity: env.IDENTITY_URL ?? 'http://127.0.0.1:4018',
      esb: env.ESB_URL ?? 'http://127.0.0.1:3300',
      graphql: env.GRAPHQL_URL ?? null,
    },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    corsOrigins: list(env.CORS_ORIGINS),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 300),
    apiKeyCacheMs: Number(env.API_KEY_CACHE_MS ?? 60_000),
    tokenCacheMs: Number(env.TOKEN_CACHE_MS ?? 30_000),
  };
}
