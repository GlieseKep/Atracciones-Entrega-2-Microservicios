import type { EsbClient } from '@atracciones/platform';
import type { Request, Response } from 'express';

/** `OutboxEventItem` del proto de Booking: el `payload` viaja como texto JSON porque protobuf no tiene objetos libres. */
interface BookingEventItem {
  specversion: string;
  source: string;
  event_id: string;
  sequence_number: number;
  event_type: string;
  aggregate_id: string;
  correlation_id: string;
  timestamp: string;
  payload_json: string;
}

const parse = (text: string): Record<string, unknown> => {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** `OutboxEventItem` del contrato (CloudEvents 1.0): `payload` y su alias `data` llevan el mismo contenido. */
export const toEventItem = ({ payload_json: payloadJson, ...event }: BookingEventItem) => {
  const payload = parse(payloadJson);
  return { ...event, payload, data: payload };
};

/** `GET /atracciones/eventos`: feed de integración de Booking (cursor `after`, `limit` ≤ 200, filtro `type`). */
export function eventHandlers(esb: EsbClient) {
  return {
    async list(req: Request, res: Response) {
      const { events } = await esb.call<{ events?: BookingEventItem[] }>('booking', 'listEvents', {
        after: Number(req.query.after ?? 0),
        limit: Math.min(Number(req.query.limit ?? 50) || 50, 200),
        type: typeof req.query.type === 'string' ? req.query.type : '',
      });
      res.setHeader('Cache-Control', 'no-store').json((events ?? []).map(toEventItem));
    },
  };
}
