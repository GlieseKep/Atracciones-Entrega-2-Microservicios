import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import express, { type Express } from 'express';
import {
  createLogger,
  EsbClient,
  MemoryCache,
  RedisCache,
  requestContext,
  currentPrincipal,
  type Cache,
  type EventBus,
} from '@atracciones/platform';
import type { GraphqlConfig } from './config';
import { CACHE_PREFIX, createContext, type GraphqlContext } from './context';
import { formatError } from './errors';
import { complexityLimit, depthLimit } from './limits';
import { resolvers } from './resolvers';
import { typeDefs } from './schema';

export interface GraphqlServer {
  app: Express;
  esb: EsbClient;
  cache: Cache;
  /** Borra la caché de lecturas públicas cuando cambian atracciones, tarifas o reseñas. */
  invalidateOn(bus: EventBus): Promise<void>;
  close(): Promise<void>;
}

/** GraphQL del portal: Apollo Server sobre Express, detrás del Gateway (que autentica y firma el principal). */
export async function createGraphqlServer(config: GraphqlConfig): Promise<GraphqlServer> {
  const logger = createLogger('graphql');
  const esb = new EsbClient(config.esbUrl);
  const cache: Cache = config.redisUrl ? new RedisCache(config.redisUrl, 'atracciones:graphql:') : new MemoryCache();
  const apollo = new ApolloServer<GraphqlContext>({
    typeDefs,
    resolvers,
    introspection: config.introspection,
    validationRules: [depthLimit(config.limits.maxDepth)],
    plugins: [complexityLimit(config.limits.maxComplexity)],
    formatError,
    // Los errores de negocio son respuestas normales; solo los defectos propios se registran como error.
    includeStacktraceInErrorResponses: false,
    logger: { debug: () => undefined, info: () => undefined, warn: (m) => logger.warn(String(m)), error: (m) => logger.error(String(m)) },
  });
  await apollo.start();

  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext(logger));
  app.get('/health', (_req, res) => {
    res.json({ status: 'UP', service: 'graphql' });
  });
  app.use(
    '/graphql',
    express.json({ limit: '256kb' }),
    expressMiddleware(apollo, {
      context: async () => createContext(esb, cache, config, await currentPrincipal(config.internalTokenSecret)),
    }),
  );

  return {
    app,
    esb,
    cache,
    invalidateOn: async (bus) => {
      await bus.subscribe('graphql.lecturas', ['catalog.*', 'pricing.*', 'review.*'], () => cache.deletePrefix(CACHE_PREFIX));
    },
    close: async () => {
      await apollo.stop();
      await cache.close();
    },
  };
}
