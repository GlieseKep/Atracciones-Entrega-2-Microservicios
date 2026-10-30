import { requireScope, type EsbClient } from '@atracciones/platform';
import type { ContractV2Schema } from '@atracciones/contracts';
import type { Request, Response } from 'express';
import type { ContractRequest } from '../request';

type OutboxEventItem = ContractV2Schema<'OutboxEventItem'>;

interface IntegrationEventDto {
  sequence_number: number;
  event_id: string;
  event_type: OutboxEventItem['event_type'];
  aggregate_id: string;
  correlation_id: string;
  ocurrido_en: string;
  payload: Record<string, unknown>;
}

/** `OutboxEventItem` (CloudEvents 1.0): `payload` y su alias oficial `data` llevan el mismo contenido. */
export const toEventItem = (e: IntegrationEventDto): OutboxEventItem => ({
  specversion: '1.0',
  source: '/api/v2/atracciones',
  event_id: e.event_id,
  sequence_number: e.sequence_number,
  event_type: e.event_type,
  aggregate_id: e.aggregate_id,
  correlation_id: e.correlation_id,
  timestamp: e.ocurrido_en.replace(/\.\d{3}Z$/, 'Z'),
  // El contrato declara `payload` como `type: object` sin propiedades: admite cualquier objeto (el tipo generado es más
  // estricto de lo que dice el YAML).
  payload: e.payload as OutboxEventItem['payload'],
  data: e.payload as OutboxEventItem['data'],
});

/** `GET /atracciones/eventos`: feed de integración servido por Audit (cursor `after`, `limit` ≤ 200, filtro `type`). */
export function eventHandlers(esb: EsbClient) {
  return {
    async list(req: Request, res: Response) {
      requireScope((req as ContractRequest).principal!, 'events:read');
      const events = await esb.call<IntegrationEventDto[]>('audit', 'listIntegrationEvents', {
        after: req.query.after ?? 0,
        limit: req.query.limit ?? 50,
        ...(typeof req.query.type === 'string' ? { type: req.query.type } : {}),
      });
      res.setHeader('Cache-Control', 'no-store').json(events.map(toEventItem));
    },
  };
}
