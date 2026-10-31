import { AppError, hasRole, type Cache, type EsbClient, type Principal } from '@atracciones/platform';
import type { GraphqlConfig } from './config';
import { toGraphqlError } from './errors';

/** Prefijo de la caché de lecturas públicas. Se borra con los eventos de Catalog, Pricing y Review. */
export const CACHE_PREFIX = 'lectura:';

export interface GraphqlContext {
  esb: EsbClient;
  cache: Cache;
  config: GraphqlConfig;
  principal: Principal | null;
  requireAdmin(): Principal;
}

export function createContext(esb: EsbClient, cache: Cache, config: GraphqlConfig, principal: Principal | null): GraphqlContext {
  return {
    esb,
    cache,
    config,
    principal,
    requireAdmin() {
      if (!principal) throw toGraphqlError(AppError.unauthorized('Inicia sesión para continuar.'));
      if (!hasRole(principal, 'ADMIN')) throw toGraphqlError(AppError.forbidden('Necesitas el rol ADMIN.'));
      return principal;
    },
  };
}
