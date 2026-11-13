import { AppError, type EsbClient, type Logger } from '@atracciones/platform';
import type { Request, Response } from 'express';
import type { ContractRequest } from '../request';

/** Respuesta de Booking (`ReservaConfirmadaResponseV2` del proto), con los mismos campos que el contrato v3. */
interface ReservationResponse {
  _links?: { self?: { href?: string } | string };
  [field: string]: unknown;
}

const idempotencyKey = (req: Request) => String(req.headers['idempotency-key'] ?? '');

/** URL de la reserva creada para la cabecera `Location`. */
const selfLink = (body: ReservationResponse) => {
  const self = body._links?.self;
  return typeof self === 'string' ? self : self?.href;
};

/**
 * Reservas del contrato v3. Booking aplica las reglas del contrato (alias, turno, fecha, pasajeros e idempotencia) y
 * orquesta la compra con Order, Inventory, Payment y Refund; la Partner API solo enruta y fija los códigos HTTP.
 */
export function reservationHandlers(esb: EsbClient, logger: Logger) {
  return {
    /** POST /atracciones/reservas: 201 con `Location`, o 409 `OUT_OF_STOCK` para que Booking compense. */
    async create(req: Request, res: Response) {
      const key = idempotencyKey(req);
      const body = { ...((req as ContractRequest).sentBody ?? req.body ?? {}) } as Record<string, unknown>;
      if (body.idempotency_key !== undefined && body.idempotency_key !== key) {
        throw AppError.unprocessable('IDEMPOTENCY_KEY_MISMATCH', 'idempotency_key del cuerpo debe ser igual a la cabecera Idempotency-Key.', [
          { name: 'idempotency_key', reason: 'Debe coincidir con la cabecera Idempotency-Key.' },
        ]);
      }
      const count = (field: string) => (typeof body[field] === 'number' ? (body[field] as number) : 0);
      logger.info('RESERVA_RECIBIDA', {
        attraction_id: body.attraction_id,
        slot_id: body.slot_id,
        boletos: count('adult_count') + count('child_count') + count('senior_count') + count('infant_count'),
        saga_id: body.saga_id ?? null,
      });
      const reserva = await esb.call<ReservationResponse>('booking', 'createReservation', { ...body, idempotency_key: key }, { idempotencyKey: key });
      const location = selfLink(reserva);
      if (location) res.location(location);
      res.status(201).json(reserva);
    },

    async get(req: Request, res: Response) {
      res.json(await esb.call<ReservationResponse>('booking', 'getReservation', { id: String(req.params.id) }));
    },

    /**
     * POST /reservas/{id}/cancel (alias /api/v3/reservas/{id}/cancel): compensación de la saga de Booking, o cancelación del
     * cliente o de un `ADMIN`, antes del check-in, con reembolso del 100 % y cupos de vuelta. Las reglas las aplica Booking.
     */
    async cancel(req: Request, res: Response) {
      const principal = (req as ContractRequest).principal!;
      const body = (req.body ?? {}) as { reason?: string; solicitante?: string };
      const solicitante = body.solicitante ?? (principal.tipo === 'API_CLIENTE' ? 'SAGA_ORCHESTRATOR' : 'CLIENTE');
      if (solicitante === 'SAGA_ORCHESTRATOR' && principal.tipo !== 'API_CLIENTE') throw AppError.forbidden('Solo un socio (X-API-Key) puede cancelar como SAGA_ORCHESTRATOR.');
      const key = idempotencyKey(req);
      res.json(await esb.call<ReservationResponse>('booking', 'cancelReservation', {
        idempotency_key: key, id: String(req.params.id), reason: body.reason ?? '', solicitante,
      }, { idempotencyKey: key }));
    },

    /** POST /reservas/{id}/checkin: identidad, voucher y fecha (solo el día del turno) los valida Booking (idempotente por cabecera). */
    async checkIn(req: Request, res: Response) {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const text = (value: unknown) => (typeof value === 'string' ? value : '');
      const key = idempotencyKey(req);
      res.json(await esb.call<unknown>('booking', 'checkIn', {
        idempotency_key: key,
        id: String(req.params.id),
        documento_identidad: text(body.documento_identidad),
        codigo_voucher_qr: text(body.codigo_voucher_qr),
        guia_codigo: text(body.guia_codigo),
        scanner_device_id: text(body.scanner_device_id),
        // Opcionales (no están en el contrato): van en el aviso a Booking Central.
        asistentes_reales: Number.isInteger(body.asistentes_reales) ? body.asistentes_reales : 0,
        observaciones: text(body.observaciones),
      }, { idempotencyKey: key }));
    },
  };
}
