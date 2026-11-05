import { randomUUID } from 'node:crypto';
import { errorFields, requirePrincipal, type Logger, type Principal } from '@atracciones/platform';
import type { PurchaseInput, ReservaResponse } from '../contract';
import type { IdempotencyRepository, IdempotencySubject } from '../persistence/idempotency-repository';
import { newReservationCode, type ReservationRepository, type ReservationRow } from '../persistence/reservation-repository';
import { onceByKey } from './idempotency';
import { seatKey, type Logistics, type OrderSummary, type Remote } from './remote';
import { toResponse } from './reservation-mapper';
import { createVoucher } from './voucher';

export const reservationEvent = (row: ReservationRow) => ({
  reservation_id: row.res_uuid,
  reservation_code: row.res_codigo,
  external_order_id: row.ord_numero,
  status: row.est_codigo,
  ticket_count: row.res_numero_tickets,
  total_price: Number(row.res_precio_total),
});

export const stockEvent = (row: ReservationRow, cuposDisponibles: number | null) => ({
  reservation_code: row.res_codigo,
  dis_id: Number(row.dis_id),
  ticket_count: row.res_numero_tickets,
  cupos_disponibles: cuposDisponibles,
});

/** Una compra no se detiene por no poder deshacer un paso: queda en el log para revisarla. */
export async function compensate(logger: Logger, step: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    logger.error('falló una compensación de la compra', { step, ...errorFields(error) });
  }
}

/** Compra: Catalog → Order → Inventory → reserva → pago. Si un paso falla, deshace los anteriores en orden inverso. */
export class PurchaseFlow {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly remote: Remote,
    private readonly secrets: { internalToken: string; voucher: string },
    private readonly basePath: string,
    private readonly logger: Logger,
  ) {}

  async run(input: PurchaseInput): Promise<ReservaResponse> {
    const principal = await requirePrincipal(this.secrets.internalToken);
    const subject: IdempotencySubject = { tipo: principal.tipo === 'USUARIO' ? 'USUARIO' : 'CLIENTE_API', id: Number(principal.id) };
    return onceByKey(this.idempotency, input.idempotencyKey, subject, 'CreateReservation', input, () => this.purchase(input, principal));
  }

  /**
   * Compra de un socio: el titular queda como turista en `cliente_api` (Identity), sin duplicarse. El RUC no identifica a
   * una persona, así que esa compra sigue sin turista enlazado.
   */
  private async client(input: PurchaseInput, principal: Principal): Promise<{ claId: number | null; canal: 'WEB' | 'SOCIO' }> {
    if (principal.tipo !== 'API_CLIENTE') return { claId: null, canal: 'WEB' };
    if (input.customer.tipoDocumento === 'RUC') return { claId: null, canal: 'SOCIO' };
    return { claId: await this.remote.ensureClient(input.customer), canal: 'SOCIO' };
  }

  private async purchase(input: PurchaseInput, principal: Principal): Promise<ReservaResponse> {
    const attraction = await this.remote.reference(input.attractionId);
    const logistics = await this.remote.logistics(attraction.id, null);
    // Antes de la orden: si Identity rechaza al titular no hay nada que deshacer.
    const client = await this.client(input, principal);
    const order = await this.remote.createOrder({
      // La clave del cliente protege la compra aquí. Un reintento tras un fallo necesita una orden nueva: la anterior quedó
      // cancelada, y con la misma clave Order la devolvería. Si Booking cae a mitad, Order cancela la huérfana a los 30 minutos.
      idempotency_key: randomUUID(),
      atr_id: attraction.atr_id,
      atr_codigo: attraction.id,
      atraccion_nombre: attraction.nombre,
      boletos: [
        { ticket_type: 'ADULT', cantidad: input.adultos },
        { ticket_type: 'CHILD', cantidad: input.ninos },
        { ticket_type: 'SENIOR', cantidad: input.seniors },
        { ticket_type: 'INFANT', cantidad: input.infantes },
      ].filter((line) => line.cantidad > 0),
      metodo: input.metodo,
      cart_item_id: input.cartItemId ?? 0,
      coupon_code: input.couponCode ?? '',
      observaciones: input.requerimientos ?? '',
      fecha: input.date,
    });
    const tickets = input.adultos + input.ninos + input.seniors + input.infantes;
    let seats: { dis_id: number; cupos_disponibles: number };
    try {
      seats = await this.remote.reserveSeats(attraction.id, input.slotId, tickets, seatKey(order.ord_numero));
    } catch (error) {
      await compensate(this.logger, 'CancelOrder', () => this.remote.cancelOrder(order.ord_numero, 'Sin cupos para la reserva'));
      throw error;
    }
    let row: ReservationRow;
    try {
      row = await this.save(input, order, seats, logistics, client);
    } catch (error) {
      await this.undoSeatsAndOrder(order.ord_numero);
      throw error;
    }
    return this.pay(input, row, logistics);
  }

  private save(
    input: PurchaseInput,
    order: OrderSummary,
    seats: { dis_id: number; cupos_disponibles: number },
    logistics: Logistics,
    client: { claId: number | null; canal: 'WEB' | 'SOCIO' },
  ): Promise<ReservationRow> {
    const uuid = randomUUID();
    const codigo = newReservationCode();
    const tickets = input.adultos + input.ninos + input.seniors + input.infantes;
    const event = { reservation_id: uuid, reservation_code: codigo, external_order_id: order.ord_numero, status: 'PENDING', ticket_count: tickets, total_price: order.total };
    return this.reservations.create(
      {
        uuid,
        codigo,
        ordNumero: order.ord_numero,
        detId: order.det_id_adulto,
        disId: seats.dis_id,
        guiId: logistics.guia?.gui_id ?? null,
        sagaId: input.sagaId,
        adultos: input.adultos,
        ninos: input.ninos,
        seniors: input.seniors,
        infantes: input.infantes,
        total: order.total,
        requerimientos: input.requerimientos,
        voucher: createVoucher({ reservationId: uuid, code: codigo, document: input.customer.documento }, this.secrets.voucher),
        customer: input.customer,
        claIdCliente: client.claId,
        canal: client.canal,
      },
      [
        { tipo: 'RESERVA_CREADA', payload: event },
        { tipo: 'STOCK_ACTUALIZADO', payload: { reservation_code: codigo, dis_id: seats.dis_id, ticket_count: tickets, cupos_disponibles: seats.cupos_disponibles } },
      ],
    );
  }

  private async pay(input: PurchaseInput, row: ReservationRow, logistics: Logistics): Promise<ReservaResponse> {
    let current = row;
    try {
      const { estado_pago: pago } = await this.remote.startPayment(row.ord_numero, input.tarjeta);
      if (pago === 'APROBADO') {
        // `null` si el evento del pago llegó antes: la reserva ya está confirmada.
        current =
          (await this.reservations.transition(row.res_id, ['PENDING'], 'CONFIRMED', { res_confirmado_en: new Date() }, (updated) => [
            { tipo: 'RESERVA_CONFIRMADA', payload: reservationEvent(updated) },
          ])) ?? (await this.reservations.find(row.res_uuid)) ?? row;
      }
    } catch (error) {
      await compensate(this.logger, 'CancelReservation', () =>
        this.reservations.transition(row.res_id, ['PENDING'], 'CANCELLED', { res_motivo_cancelacion: 'Fallo al iniciar el pago', res_cancelado_por: 'SAGA_ORCHESTRATOR', res_cancelado_en: new Date() }, (updated) => [
          { tipo: 'RESERVA_CANCELADA', payload: reservationEvent(updated) },
          { tipo: 'STOCK_ACTUALIZADO', payload: stockEvent(updated, null) },
        ]),
      );
      await this.undoSeatsAndOrder(row.ord_numero);
      throw error;
    }
    return toResponse(current, await this.remote.slot(Number(row.dis_id)), logistics, this.basePath);
  }

  private async undoSeatsAndOrder(ordNumero: string): Promise<void> {
    await compensate(this.logger, 'ReleaseSeats', () => this.remote.releaseSeats(seatKey(ordNumero)));
    await compensate(this.logger, 'CancelOrder', () => this.remote.cancelOrder(ordNumero, 'Fallo en la compra'));
  }
}
