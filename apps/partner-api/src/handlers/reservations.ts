import {
  AppError,
  normalizeTime,
  parseSlotId,
  PROBLEM_CONTENT_TYPE,
  problemType,
  requireScope,
  statusTitle,
  todayIn,
  type EsbClient,
  type ProblemDetails,
} from '@atracciones/platform';
import type { ContractV2Schema } from '@atracciones/contracts';
import type { Request, Response } from 'express';
import type { ContractStatuses } from '../contract';
import { toCheckin, toReservation, type ReservationDto } from '../mappers/reservations';
import { aliased, type ContractRequest } from '../request';
import { aliasConflicts, CUSTOMER_ALIASES, RESERVATION_ALIASES, validateCustomer } from '../validation';

type CreateRequest = ContractV2Schema<'CreateReservaRequestV2'>;

/** Respuesta de Order (proto `OrderResponse`), tal como se guardó para la idempotencia. */
interface OrderResponse {
  status: number;
  reserva: ReservationDto | null;
  problem: { code: string; title: string; detail: string; correlation_id: string; timestamp: string; invalid_params: { name: string; reason: string }[] } | null;
  guia_asignado: string;
}

/** `/api/v2` o `/api/v1`, según por dónde llegó la petición (los enlaces conservan el prefijo). */
const basePath = (req: Request) => (req.baseUrl.startsWith('/api/v1') ? '/api/v1' : '/api/v2');
const TICKETS = [['ADULT', 'adult_count', 'cantidad_adultos'], ['CHILD', 'child_count', 'cantidad_ninos'], ['SENIOR', 'senior_count', 'cantidad_seniors'],
  ['STUDENT', 'student_count', 'cantidad_estudiantes'], ['INFANT', 'infant_count', 'cantidad_infantes']] as const;

export interface ReservationHandlerDeps {
  esb: EsbClient;
  statuses: ContractStatuses;
  timeZone: string;
}

export function reservationHandlers({ esb, statuses, timeZone }: ReservationHandlerDeps) {
  /**
   * Envía la respuesta guardada de la saga: la reserva, o el error de negocio con su `correlation_id` y `timestamp`
   * originales (una repetición con la misma Idempotency-Key devuelve exactamente lo mismo).
   */
  async function send(req: Request, res: Response, result: OrderResponse, successStatus: number): Promise<void> {
    const route = (req as ContractRequest).openapi?.openApiRoute ?? '';
    if (result.status >= 200 && result.status < 300 && result.reserva) {
      const body = toReservation(result.reserva, result.guia_asignado, basePath(req));
      if (successStatus === 201) res.location(body._links!.self!);
      res.status(successStatus).json(body);
      return;
    }
    const p = result.problem!;
    const status = statuses.normalize(req.method, route, result.status);
    const problem: ProblemDetails = {
      type: problemType(p.code),
      title: status === result.status ? p.title : statusTitle(status),
      status,
      detail: p.detail,
      instance: req.originalUrl.split('?')[0],
      code: p.code,
      ...(p.correlation_id ? { correlation_id: p.correlation_id } : {}),
      timestamp: p.timestamp,
      ...(p.invalid_params?.length ? { invalid_params: p.invalid_params } : {}),
    };
    res.status(status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
  }

  const guideName = async (codigo: string) => {
    if (!codigo) return 'Sin guía asignado (acceso libre)';
    try {
      return (await esb.call<{ nombre_visible: string }>('inventory', 'getGuide', { codigo })).nombre_visible;
    } catch {
      return codigo;
    }
  };

  return {
    /** POST /atracciones/reservas: valida la forma y las reglas del contrato y delega la saga de compra en Order. */
    async create(req: Request, res: Response) {
      const principal = (req as ContractRequest).principal!;
      requireScope(principal, 'attractions:book');
      const body = req.body as CreateRequest;
      const sent = (req as ContractRequest).sentBody ?? {};
      const key = String(req.headers['idempotency-key']);

      const conflicts = [
        ...aliasConflicts(sent, RESERVATION_ALIASES),
        ...aliasConflicts(sent.customer as Record<string, unknown> | undefined, CUSTOMER_ALIASES, 'customer.'),
      ];
      if (conflicts.length) throw AppError.unprocessable('ALIAS_CONFLICT', 'Un campo y su alias en español tienen valores distintos.', conflicts);
      if (body.idempotency_key !== undefined && body.idempotency_key !== key) {
        throw AppError.unprocessable('IDEMPOTENCY_KEY_MISMATCH', 'idempotency_key del cuerpo debe ser igual a la cabecera Idempotency-Key.', [{ name: 'idempotency_key', reason: 'Debe coincidir con la cabecera Idempotency-Key.' }]);
      }

      const customer = {
        full_name: body.customer.full_name.trim(),
        email: body.customer.email,
        phone: body.customer.phone,
        document_type: body.customer.document_type,
        document_id: body.customer.document_id.trim(),
      };
      const invalidCustomer = validateCustomer(customer);
      if (invalidCustomer) throw AppError.unprocessable(invalidCustomer.code, 'Los datos del titular no son válidos.', invalidCustomer.invalid);

      if (body.fecha < todayIn(timeZone)) {
        throw AppError.unprocessable('DATE_IN_PAST', `La fecha ${body.fecha} ya pasó.`, [{ name: 'fecha', reason: 'Debe ser hoy o una fecha futura.' }]);
      }
      const slot = parseSlotId(body.slot_id);
      const hora = normalizeTime(body.hora);
      const time24 = body.time_24h ? normalizeTime(body.time_24h) : hora;
      if (!slot || slot.date !== body.fecha || !hora || hora !== slot.time || time24 !== slot.time) {
        throw AppError.unprocessable('SLOT_MISMATCH', 'El slot_id no corresponde a la fecha y hora indicadas.', [{ name: 'slot_id', reason: `Debe ser slot-${body.fecha.replace(/-/g, '')}-HHmm con la misma hora que 'hora'.` }]);
      }

      const boletos = TICKETS.map(([type, en, es]) => ({ ticket_type: type, cantidad: aliased(sent, en, es, 0) as number }));
      const passengers = body.passengers ?? [];
      const overflow = boletos.filter((b) => passengers.filter((p) => p.ticket_type === b.ticket_type).length > b.cantidad);
      if (overflow.length) {
        throw AppError.unprocessable('PASSENGERS_MISMATCH', 'Hay más pasajeros de un tipo que boletos de ese tipo.', overflow.map((b) => ({ name: 'passengers', reason: `Hay más pasajeros ${b.ticket_type} que boletos ${b.ticket_type} (${b.cantidad}).` })));
      }

      const result = await esb.call<OrderResponse>('order', 'createOrder', {
        idempotency_key: key,
        atraccion_id: body.atraccion_id,
        fecha: body.fecha,
        hora: slot.time,
        boletos,
        customer,
        passengers: passengers.map((p) => ({ full_name: p.full_name, document_id: p.document_id ?? '', ticket_type: p.ticket_type })),
        payment_method: aliased(sent, 'payment_method', 'metodo_pago', body.payment_method),
        saga_id: body.saga_id ?? '',
        observaciones: aliased(sent, 'special_requirements', 'observaciones', ''),
      }, { idempotencyKey: key, timeoutMs: 15_000 });
      await send(req, res, result, 201);
    },

    async get(req: Request, res: Response) {
      requireScope((req as ContractRequest).principal!, 'attractions:read');
      const reserva = await esb.call<ReservationDto>('booking', 'getReservation', { id: String(req.params.id) });
      res.json(toReservation(reserva, await guideName(reserva.guia_codigo), basePath(req)));
    },

    /** POST /reservas/{id}/cancel: compensación de la saga de Booking o cancelación voluntaria del cliente. */
    async cancel(req: Request, res: Response) {
      const principal = (req as ContractRequest).principal!;
      requireScope(principal, 'attractions:cancel');
      const body = (req.body ?? {}) as ContractV2Schema<'CancelReservationRequest'>;
      const solicitante = body.solicitante ?? 'CLIENTE';
      if (solicitante === 'ADMIN' && !principal.scopes.includes('attractions:write')) throw AppError.forbidden('Solo un administrador puede cancelar como ADMIN.');
      if (solicitante === 'SAGA_ORCHESTRATOR' && principal.tipo !== 'API_CLIENTE') throw AppError.forbidden('Solo un socio (X-API-Key) puede cancelar como SAGA_ORCHESTRATOR.');
      const key = String(req.headers['idempotency-key']);
      const result = await esb.call<OrderResponse>('order', 'cancelReservation', {
        idempotency_key: key, reservation_id: String(req.params.id), reason: body.reason ?? '', solicitante,
      }, { idempotencyKey: key, timeoutMs: 15_000 });
      await send(req, res, result, 200);
    },

    /** POST /reservas/{id}/checkin: identidad, voucher y fecha los valida Booking (idempotente por cabecera). */
    async checkIn(req: Request, res: Response) {
      requireScope((req as ContractRequest).principal!, 'attractions:checkin');
      const body = req.body as ContractV2Schema<'CheckinRequest'>;
      const reserva = await esb.call<ReservationDto>('booking', 'checkIn', {
        id: String(req.params.id),
        documento_identidad: body.documento_identidad,
        codigo_voucher_qr: body.codigo_voucher_qr ?? '',
        guia_codigo: body.guia_codigo ?? '',
        scanner_device_id: body.scanner_device_id ?? '',
      }, { idempotencyKey: String(req.headers['idempotency-key']) });
      res.json(toCheckin(reserva, await guideName(reserva.guia_codigo)));
    },
  };
}
