import type { Cache, EsbClient, Logger } from '@atracciones/platform';
import type { Router } from 'express';
import type { PartnerApiConfig } from './config';
import type { ContractStatuses } from './contract';
import { catalogHandlers } from './handlers/catalog';
import { eventHandlers } from './handlers/events';
import { reservationHandlers } from './handlers/reservations';
import type { NodeHealth } from './health';

export interface RouteDeps {
  esb: EsbClient;
  cache: Cache;
  statuses: ContractStatuses;
  config: PartnerApiConfig;
  nodeHealth: NodeHealth;
  logger: Logger;
}

/**
 * Operaciones del contrato. Las rutas fijas se registran antes que `/atracciones/:id` para que `search`, `reservas`,
 * `promociones`, `eventos` y `health` no se confundan con un identificador (plan §4).
 */
export function registerRoutes(router: Router, deps: RouteDeps): void {
  const catalog = catalogHandlers(deps);
  const reservations = reservationHandlers({ esb: deps.esb, statuses: deps.statuses, timeZone: deps.config.timeZone });

  router.get('/atracciones/health', async (_req, res) => {
    const report = await deps.nodeHealth.report();
    res.status(report.status === 'DOWN' ? 503 : 200).json(report);
  });

  router.get('/atracciones/categorias/arbol', catalog.categoryTree);
  router.get('/atracciones/categorias', catalog.categories);
  router.post('/atracciones/search', catalog.search);
  router.get('/atracciones/eventos', eventHandlers(deps.esb).list);
  router.get('/atracciones/promociones/contrato', catalog.getAgreement);
  router.put('/atracciones/promociones/contrato', catalog.putAgreement);
  router.post('/atracciones/reservas', reservations.create);
  router.get('/atracciones/reservas/:id', reservations.get);
  router.post('/atracciones/reservas/:id/cancel', reservations.cancel);
  router.post('/atracciones/reservas/:id/checkin', reservations.checkIn);
  router.get('/atracciones', catalog.list);
  router.get('/atracciones/:id', catalog.detail);
  router.get('/atracciones/:id/disponibilidad', catalog.availability);
}
