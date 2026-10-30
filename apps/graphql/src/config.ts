import { BUSINESS_TIME_ZONE } from '@atracciones/platform';

export interface GraphqlConfig {
  port: number;
  esbUrl: string;
  /** Secreto compartido con el Gateway para verificar el principal interno. */
  internalTokenSecret: string;
  /** Redis para los read models (catálogo y resúmenes de órdenes); sin él, caché en memoria. */
  redisUrl: string | null;
  timeZone: string;
  limits: {
    /** Profundidad máxima de una operación (D3 ③). */
    maxDepth: number;
    /** Costo máximo estimado (cada campo cuesta 1; las listas multiplican por su `limit`). */
    maxComplexity: number;
  };
  /** Introspección y página de pruebas (Apollo Sandbox): solo fuera de producción. */
  introspection: boolean;
  cacheSeconds: { catalog: number; orders: number };
}

export function readGraphqlConfig(env: NodeJS.ProcessEnv = process.env): GraphqlConfig {
  const secret = env.INTERNAL_TOKEN_SECRET ?? '';
  if (secret.length < 32) throw new Error('INTERNAL_TOKEN_SECRET debe tener al menos 32 caracteres.');
  return {
    port: Number(env.PORT ?? 3200),
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    internalTokenSecret: secret,
    redisUrl: env.REDIS_URL ?? null,
    timeZone: env.APP_TIMEZONE ?? BUSINESS_TIME_ZONE,
    limits: { maxDepth: Number(env.GRAPHQL_MAX_DEPTH ?? 8), maxComplexity: Number(env.GRAPHQL_MAX_COMPLEXITY ?? 2500) },
    introspection: (env.GRAPHQL_INTROSPECTION ?? (env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    cacheSeconds: { catalog: Number(env.CATALOG_CACHE_SECONDS ?? 60), orders: Number(env.ORDERS_CACHE_SECONDS ?? 30) },
  };
}
