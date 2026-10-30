export interface PartnerApiConfig {
  port: number;
  esbUrl: string;
  /** Redis para los read models del catálogo; sin él, caché en memoria. */
  redisUrl: string | null;
  /** Secreto compartido con el Gateway para verificar el principal interno. */
  internalTokenSecret: string;
  /** Valida también las respuestas contra el contrato (desarrollo y pruebas; plan C9). */
  validateResponses: boolean;
  /** Zona del negocio (validación de `fecha` no pasada). */
  timeZone: string;
  node: { id: string; code: string; publicBaseUrl: string; version: string };
  /** Servicios cuya salud se agrega en `GET /atracciones/health` (§7.6). */
  health: { critical: string[]; optional: string[]; cacheMs: number; timeoutMs: number };
}

const list = (value: string | undefined, fallback: string[]) =>
  value === undefined ? fallback : value.split(',').map((s) => s.trim()).filter(Boolean);

export function readPartnerApiConfig(env: NodeJS.ProcessEnv = process.env): PartnerApiConfig {
  const secret = env.INTERNAL_TOKEN_SECRET ?? '';
  if (secret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  return {
    port: Number(env.PORT ?? 3100),
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    redisUrl: env.REDIS_URL ?? null,
    internalTokenSecret: secret,
    validateResponses: (env.VALIDATE_RESPONSES ?? (env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    timeZone: env.APP_TIMEZONE ?? 'America/Guayaquil',
    node: {
      id: env.NODE_ID ?? 'node-atracciones-01',
      code: env.NODE_CODE ?? 'TOURGIRLS_ATRACCIONES',
      publicBaseUrl: env.PUBLIC_BASE_URL ?? 'http://localhost:3000/api/v2',
      version: '2.0.0',
    },
    health: {
      critical: list(env.HEALTH_CRITICAL_SERVICES, ['catalog', 'inventory', 'order', 'booking']),
      optional: list(env.HEALTH_OPTIONAL_SERVICES, ['payment', 'audit']),
      cacheMs: Number(env.HEALTH_CACHE_MS ?? 2000),
      timeoutMs: Number(env.HEALTH_TIMEOUT_MS ?? 500),
    },
  };
}
