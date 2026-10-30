import { randomUUID } from 'node:crypto';
import {
  AppError,
  currentContext,
  currentCorrelationId,
  errorFields,
  IdempotencyStore,
  money,
  zonedToUtc,
  type EsbClient,
  type Logger,
  type Principal,
} from '@atracciones/platform';
import { newExternalOrderId, type OrderRepository, type Paso } from '../persistence/order-repository';

export interface Ticket {
  ticket_type: string;
  cantidad: number;
}

export interface CreateOrderInput {
  idempotency_key: string;
  atraccion_id: string;
  fecha: string;
  hora: string;
  boletos: Ticket[];
  customer: Record<string, string>;
  passengers: { full_name: string; document_id: string; ticket_type: string }[];
  payment_method: string;
  saga_id: string;
  observaciones: string;
}

/** Respuesta de la saga (proto `OrderResponse`): se guarda tal cual para la idempotencia. */
export interface OrderResponse {
  status: number;
  reserva?: Record<string, unknown> | null;
  problem?: { code: string; title: string; detail: string; correlation_id: string; timestamp: string; invalid_params: { name: string; reason: string }[] } | null;
  guia_asignado?: string;
}

interface Attraction {
  codigo_publico: string;
  punto_encuentro: string;
  cancelacion_gratuita: boolean;
  cancelacion_horas_limite: number;
}

interface Tariff {
  moneda: string;
  adult: number;
  child: number;
  senior: number;
  infant: number;
  student: number;
  has_student: boolean;
}

/** Claves de idempotencia de cada paso. Llevan el id de la orden: cada intento de compra es independiente. */
export const stepKey = (ordenId: string, paso: 'inventory' | 'payment') => `${ordenId}:${paso}`;

const isTechnical = (error: unknown) => !(error instanceof AppError) || error.status >= 500;

/** Error de negocio guardado en la respuesta (se repite idéntico ante la misma Idempotency-Key). */
export function storedProblem(error: AppError): OrderResponse {
  return {
    status: error.status,
    problem: {
      code: error.code,
      title: error.title,
      detail: error.message,
      correlation_id: currentCorrelationId() ?? '',
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      invalid_params: error.invalidParams ?? [],
    },
  };
}

/**
 * Saga de compra orquestada (plan §5.1): Catalog → tarifa → bloqueo de cupos → pago → emisión de la reserva. Cada paso
 * ejecutado se registra en `orden_paso_saga` y, ante cualquier fallo, se compensa en orden inverso (LIFO).
 */
export class PurchaseSaga {
  constructor(
    private readonly esb: EsbClient,
    private readonly orders: OrderRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly logger: Logger,
    private readonly timeZone: string,
  ) {}

  async run(principal: Principal, input: CreateOrderInput): Promise<OrderResponse> {
    const { idempotency_key: key, ...payload } = input;
    const start = await this.idempotency.begin<OrderResponse>(principal, 'create-reservation', key, payload);
    if ('replay' in start) return start.replay.body;
    try {
      const response = await this.purchase(principal, input);
      await this.idempotency.complete(start.recordId, { status: response.status, body: response });
      return response;
    } catch (error) {
      // Falla técnica: no se guarda la respuesta, el cliente puede reintentar con la misma clave.
      await this.idempotency.abandon(start.recordId).catch(() => undefined);
      throw error;
    }
  }

  private async purchase(principal: Principal, input: CreateOrderInput): Promise<OrderResponse> {
    const ordenId = randomUUID();
    const codigoExterno = newExternalOrderId();
    let created = false;
    // Paso en curso: si su llamada falla por plazo, el servicio pudo haberlo ejecutado igual y también se compensa.
    let inFlight: Paso | null = null;
    try {
      const attraction = await this.esb.call<Attraction>('catalog', 'getAttraction', { id: input.atraccion_id }).catch((error: unknown) => {
        if (error instanceof AppError && error.status === 404) throw AppError.unprocessable('ATTRACTION_NOT_FOUND', `La atracción '${input.atraccion_id}' no existe o no está activa.`, [{ name: 'atraccion_id', reason: 'No existe una atracción activa con ese identificador.' }]);
        throw error;
      });
      const tariff = await this.esb.call<Tariff>('inventory', 'getTariff', { atraccion_codigo: attraction.codigo_publico, fecha: input.fecha }).catch((error: unknown) => {
        if (error instanceof AppError && error.status === 404) throw AppError.unprocessable('TARIFF_NOT_FOUND', `La atracción no tiene tarifa vigente el ${input.fecha}.`);
        throw error;
      });
      const prices: Record<string, number | null> = {
        ADULT: tariff.adult, CHILD: tariff.child, SENIOR: tariff.senior, INFANT: tariff.infant, STUDENT: tariff.has_student ? tariff.student : null,
      };
      const boletos = input.boletos.filter((b) => b.cantidad > 0).map((b) => {
        const price = prices[b.ticket_type];
        if (price === null || price === undefined) {
          throw AppError.unprocessable('TICKET_TYPE_NOT_AVAILABLE', `La atracción no vende boletos de tipo ${b.ticket_type}.`, [{ name: 'student_count', reason: 'La atracción no tiene tarifa de estudiante.' }]);
        }
        return { tipo: b.ticket_type, cantidad: b.cantidad, precio: money(price) };
      });
      const total = money(boletos.reduce((sum, b) => sum + b.cantidad * b.precio, 0));
      const seats = boletos.reduce((sum, b) => sum + b.cantidad, 0);

      await this.orders.insert({
        id: ordenId, codigoExterno, principalTipo: principal.tipo, principalId: principal.id, sagaId: input.saga_id || null,
        nodeId: currentContext()?.nodeId ?? null, metodoPago: input.payment_method, moneda: tariff.moneda,
        atraccionCodigo: attraction.codigo_publico, fecha: input.fecha, hora: input.hora, boletos,
      });
      created = true;

      // Paso 1: bloqueo atómico de cupos (incluye infantes).
      inFlight = 'RESERVAR_CUPOS';
      const seat = await this.esb.call<{ guia_codigo: string }>('inventory', 'reserveSeats', {
        atraccion_codigo: attraction.codigo_publico, fecha: input.fecha, hora: input.hora, cantidad: seats, orden_id: ordenId,
        clave_idempotencia: stepKey(ordenId, 'inventory'),
      }).catch((error: unknown) => {
        if (error instanceof AppError && error.code === 'SLOT_NOT_FOUND') {
          throw AppError.unprocessable('SLOT_MISMATCH', error.message, [{ name: 'slot_id', reason: 'No hay un turno a la venta con esa fecha y hora.' }]);
        }
        throw error;
      });
      await this.step(ordenId, 'RESERVAR_CUPOS', 'CUPOS_RESERVADOS');

      // Paso 2: pago.
      inFlight = 'REGISTRAR_PAGO';
      const pago = await this.esb.call<{ estado: string; motivo_rechazo: string | null }>('payment', 'registerPayment', {
        orden_id: ordenId, metodo_pago: input.payment_method, monto: total, moneda: tariff.moneda,
        referencia_externa: input.saga_id || undefined, clave_idempotencia: stepKey(ordenId, 'payment'),
      });
      await this.step(ordenId, 'REGISTRAR_PAGO', 'PAGO_REGISTRADO');
      if (pago.estado === 'RECHAZADO') {
        throw AppError.unprocessable('PAYMENT_REJECTED', `El pago fue rechazado: ${pago.motivo_rechazo ?? 'sin detalle'}.`, [{ name: 'payment_method', reason: pago.motivo_rechazo ?? 'Pago rechazado.' }]);
      }

      // Paso 3: emisión de la reserva (PNR, voucher, pasajeros, guía).
      const deadline = attraction.cancelacion_gratuita
        ? new Date(zonedToUtc(input.fecha, input.hora, this.timeZone).getTime() - attraction.cancelacion_horas_limite * 3_600_000).toISOString()
        : '';
      inFlight = 'EMITIR_RESERVA';
      const reserva = await this.esb.call<Record<string, unknown> & { reservation_code: string; guia_codigo: string }>('booking', 'createReservation', {
        external_order_id: codigoExterno, principal_tipo: principal.tipo, principal_id: principal.id, atraccion_codigo: attraction.codigo_publico,
        fecha: input.fecha, hora: input.hora, boletos: boletos.map((b) => ({ ticket_type: b.tipo, cantidad: b.cantidad })), total, moneda: tariff.moneda,
        customer: input.customer, passengers: input.passengers, guia_codigo: seat.guia_codigo, punto_encuentro: attraction.punto_encuentro,
        cancelable_hasta: deadline, observaciones: input.observaciones,
      });
      await this.step(ordenId, 'EMITIR_RESERVA', 'RESERVA_EMITIDA');
      inFlight = null;
      await this.orders.confirm(ordenId, reserva.reservation_code);
      return { status: 201, reserva, guia_asignado: await this.guideName(reserva.guia_codigo) };
    } catch (error) {
      if (created) {
        const technical = isTechnical(error);
        await this.compensate(ordenId, codigoExterno, technical ? 'Falla técnica en la saga de compra' : 'Saga de compra rechazada', technical && inFlight ? [inFlight] : []);
      }
      if (isTechnical(error)) {
        this.logger.error('saga de compra interrumpida por una falla técnica', { orden_id: ordenId, ...errorFields(error) });
        throw error instanceof AppError ? error : AppError.internal();
      }
      return storedProblem(error as AppError);
    }
  }

  private async step(ordenId: string, paso: Paso, estado: 'CUPOS_RESERVADOS' | 'PAGO_REGISTRADO' | 'RESERVA_EMITIDA'): Promise<void> {
    await this.orders.recordStep(ordenId, paso, 'EJECUTAR', 'OK');
    await this.orders.setSaga(ordenId, estado);
  }

  /** Nombre visible del guía para `guia_asignado`; un fallo al consultarlo no tumba una compra ya hecha. */
  private async guideName(codigo: string): Promise<string> {
    if (!codigo) return 'Sin guía asignado (acceso libre)';
    try {
      return (await this.esb.call<{ nombre_visible: string }>('inventory', 'getGuide', { codigo })).nombre_visible;
    } catch {
      return codigo;
    }
  }

  /**
   * Compensa en orden inverso los pasos ejecutados (LIFO). Cada compensación es idempotente; si alguna falla, la orden
   * queda en COMPENSANDO y el worker de recuperación la reintenta.
   */
  async compensate(ordenId: string, codigoExterno: string, motivo: string, inDoubt: Paso[] = []): Promise<boolean> {
    await this.orders.setSaga(ordenId, 'COMPENSANDO');
    const ORDER: Paso[] = ['EMITIR_RESERVA', 'REGISTRAR_PAGO', 'RESERVAR_CUPOS'];
    const pending = new Set([...(await this.orders.pendingCompensations(ordenId)), ...inDoubt]);
    let complete = true;
    for (const paso of ORDER.filter((p) => pending.has(p))) {
      try {
        if (paso === 'EMITIR_RESERVA') {
          await this.esb.call('booking', 'cancelReservation', { id: codigoExterno, motivo, solicitante: 'SAGA_ORCHESTRATOR' }).catch((error: unknown) => {
            // Si la reserva nunca llegó a emitirse, no hay nada que cancelar.
            if (!(error instanceof AppError && error.status === 404)) throw error;
          });
        } else if (paso === 'REGISTRAR_PAGO') {
          await this.esb.call('payment', 'voidPayment', { clave_idempotencia: stepKey(ordenId, 'payment') });
        } else {
          await this.esb.call('inventory', 'releaseSeats', { clave_idempotencia: stepKey(ordenId, 'inventory') });
        }
        await this.orders.recordStep(ordenId, paso, 'COMPENSAR', 'OK');
      } catch (error) {
        complete = false;
        await this.orders.recordStep(ordenId, paso, 'COMPENSAR', 'ERROR', error instanceof Error ? error.message : String(error));
        this.logger.warn('compensación pendiente', { orden_id: ordenId, paso, ...errorFields(error) });
        // Un paso confirmado bloquea a los anteriores (LIFO estricto). Uno en duda (quizá nunca se ejecutó) no: se siguen
        // liberando cupos y pago, y el worker de recuperación reintenta este paso.
        if (!inDoubt.includes(paso)) break;
      }
    }
    if (complete) await this.orders.close(ordenId, 'FALLIDA', 'COMPENSADA');
    return complete;
  }
}
