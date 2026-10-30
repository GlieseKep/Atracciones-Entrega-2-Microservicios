import { AppError, contextFromHeaders, createHttpService, httpJson, runWithContext } from '@atracciones/platform';
import type { Express } from 'express';
import type { CartRestRoute } from '../src';

/**
 * ESB mínimo para las pruebas: `POST /esb/{servicio}/{operacion}` con una tabla de rutas REST, igual que el adaptador
 * REST de `apps/esb` (sustituye los `:parametros`, manda el resto en la query o el cuerpo y propaga el contexto).
 */
export function fakeEsb(routes: Record<string, CartRestRoute>, targets: Record<string, string>): Express {
  return createHttpService({
    service: 'fake-esb',
    routes: (app) => {
      app.post('/esb/:service/:operation', async (req, res) => {
        const route = routes[`${req.params.service}.${req.params.operation}`];
        if (!route) throw AppError.notFound(`El ESB no tiene la ruta '${req.params.service}.${req.params.operation}'.`, 'ROUTE_NOT_FOUND');
        const rest: Record<string, unknown> = { ...(req.body ?? {}) };
        const path = route.path.replace(/:([A-Za-z_]+)/g, (_m, name: string) => {
          const value = rest[name];
          delete rest[name];
          if (value === undefined || value === null || value === '') throw AppError.validation(`Falta el parámetro '${name}'.`);
          return encodeURIComponent(String(value));
        });
        const withQuery = route.method === 'GET' || route.method === 'DELETE';
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(rest)) if (value !== undefined && value !== null) params.append(key, String(value));
        const query = params.toString();
        const context = contextFromHeaders((name) => req.headers[name]);
        const { body } = await runWithContext(context, () =>
          httpJson(`${targets[route.target]}${path}${withQuery && query ? `?${query}` : ''}`, {
            method: route.method,
            body: withQuery ? undefined : rest,
            timeoutMs: route.timeoutMs,
          }));
        res.json(body ?? null);
      });
    },
  });
}
