import { AppError, cached, type ServiceHealth } from '@atracciones/platform';
import { CACHE_PREFIX, type GraphqlContext } from './context';
import { toGraphqlError } from './errors';
import { fieldName, OPERATIONS, SERVICES, type Operation } from './operations';
import { scalars } from './resolvers/scalars';

type Args = { input?: Record<string, unknown> | null; idempotencyKey?: string };

/** Clave de caché estable: el mismo `input` con las claves en otro orden da la misma clave. */
const cacheKey = (op: Operation, input: Record<string, unknown>) =>
  `${CACHE_PREFIX}${op.service}.${op.operation}:${JSON.stringify(input, Object.keys(input).sort())}`;

function resolverFor(op: Operation) {
  return async (_: unknown, args: Args, ctx: GraphqlContext) => {
    const input = { ...(args.input ?? {}) };
    // Booking recibe la clave en el mensaje del proto; los servicios REST, en la cabecera `Idempotency-Key`.
    if (op.idempotent && op.service === 'booking') input.idempotency_key = args.idempotencyKey;
    const call = () => ctx.esb.call<unknown>(op.service, op.operation, input, op.idempotent ? { idempotencyKey: args.idempotencyKey } : {});
    try {
      return op.cacheSeconds ? await cached(ctx.cache, cacheKey(op, input), op.cacheSeconds, call) : await call();
    } catch (error) {
      throw toGraphqlError(error);
    }
  };
}

const byKind = (kind: Operation['kind']) =>
  Object.fromEntries(OPERATIONS.filter((op) => op.kind === kind).map((op) => [fieldName(op), resolverFor(op)]));

export const resolvers = {
  JSON: scalars.JSON,
  Query: {
    ...byKind('query'),

    me: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      if (ctx.principal?.tipo !== 'USUARIO') return null;
      try {
        return await ctx.esb.call<unknown>('identity', 'getMe');
      } catch (error) {
        if (error instanceof AppError && (error.status === 401 || error.status === 404)) return null;
        throw toGraphqlError(error);
      }
    },

    /** Consulta en paralelo `<servicio>.health` por el ESB. DOWN si algún servicio no responde o no tiene base. */
    systemHealth: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      ctx.requireAdmin();
      const services = await Promise.all(SERVICES.map(async (service) => {
        const begin = performance.now();
        try {
          const health = await ctx.esb.call<ServiceHealth>(service, 'health', {}, { timeoutMs: 3000 });
          return { service, status: health.status, latencyMs: Math.round(performance.now() - begin), databaseConnected: health.database_connected ?? null, error: null };
        } catch (error) {
          return { service, status: 'DOWN', latencyMs: Math.round(performance.now() - begin), databaseConnected: null, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      return {
        status: services.every((s) => s.status === 'UP') ? 'UP' : services.some((s) => s.status === 'DOWN') ? 'DOWN' : 'DEGRADED',
        checkedAt: new Date().toISOString(),
        services,
      };
    },
  },
  Mutation: byKind('mutation'),
};
