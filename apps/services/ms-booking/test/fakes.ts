import { createLogger, runWithContext, signInternalPrincipal, type Logger, type Principal } from '@atracciones/platform';
import type { EntityManager } from 'typeorm';
import type { CheckinNotifier } from '../src/application/checkin-notifier';
import type { Remote } from '../src/application/remote';
import type { PurchaseInput, ReservationState } from '../src/contract';
import type { CheckinNotificationPayload, CheckinNotificationRepository } from '../src/persistence/checkin-notification-repository';
import type { IdempotencyRepository, IdempotencySubject, Reservation } from '../src/persistence/idempotency-repository';
import type { NewReservation, OutgoingEvent, ReservationRepository, ReservationRow } from '../src/persistence/reservation-repository';

/** Dobles de ms-booking para las pruebas unitarias de `src/application/*` (plan §2.1). */

export const SECRET = 'secreto-interno-de-pruebas-con-mas-de-32-caracteres';
export const VOUCHER_SECRET = 'secreto-del-voucher-de-pruebas-con-32-caracteres';
export const SOCIO: Principal = { tipo: 'API_CLIENTE', id: '9', scopes: ['attractions:book'], nombre: 'Booking' };
export const USUARIO: Principal = { tipo: 'USUARIO', id: '3', scopes: ['CLIENTE'], nombre: 'Ana' };
export const ADMIN: Principal = { tipo: 'USUARIO', id: '1', scopes: ['ADMIN'], nombre: 'Admin' };

export const silentLogger = (): Logger => {
  process.env.LOG_SILENT = 'true';
  return createLogger('pruebas');
};

/** Ejecuta `work` como si la petición llegara con el principal firmado por el Gateway. */
export async function as<T>(principal: Principal, work: () => Promise<T>): Promise<T> {
  const principalToken = await signInternalPrincipal(principal, SECRET, 3600);
  return runWithContext({ correlationId: 'cid-prueba', principalToken }, work);
}

let seq = 0;

export function reservationRow(overrides: Partial<ReservationRow> = {}): ReservationRow {
  seq += 1;
  return {
    res_id: String(seq),
    res_uuid: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    res_codigo: `DEC-AAAA${String(seq).padStart(2, '0')}`.slice(0, 10),
    ord_numero: `ORD-${seq}`,
    det_id: '1',
    dis_id: '50',
    gui_id: null,
    est_codigo: 'CONFIRMED',
    res_adultos: 2,
    res_ninos: 0,
    res_seniors: 0,
    res_estudiantes: 0,
    res_infantes: 0,
    res_numero_tickets: 2,
    res_precio_total: '90.00',
    res_voucher_qr: null,
    res_reembolso_id: null,
    res_monto_reembolsado: null,
    res_checkin_en: null,
    res_creado_en: new Date('2026-11-01T12:00:00Z'),
    cla_id_cliente: null,
    res_canal: 'SOCIO',
    nch_enviado_en: null,
    nch_intentos: null,
    pax_nombre: 'Ana Pérez',
    pax_tipo_documento: 'CEDULA',
    pax_documento: '1710034065',
    pax_correo: 'ana@correo.com',
    pax_telefono: '0991234567',
    ...overrides,
  };
}

/** Fake de ReservationRepository: filas en memoria y eventos registrados por transacción. */
export class FakeReservations {
  readonly rows = new Map<string, ReservationRow>();
  readonly events: OutgoingEvent[] = [];
  failCreate: Error | null = null;
  private seq = 1000;

  add(row: ReservationRow): ReservationRow {
    this.rows.set(row.res_id, row);
    return row;
  }

  async find(id: string): Promise<ReservationRow | null> {
    return [...this.rows.values()].find((r) => r.res_uuid === id.toLowerCase() || r.res_codigo === id.toUpperCase()) ?? null;
  }

  async findByOrder(ordNumero: string): Promise<ReservationRow | null> {
    return [...this.rows.values()].find((r) => r.ord_numero === ordNumero) ?? null;
  }

  async listByOrders(numeros: string[]): Promise<ReservationRow[]> {
    return [...this.rows.values()].filter((r) => numeros.includes(r.ord_numero));
  }

  async create(data: NewReservation, events: OutgoingEvent[]): Promise<ReservationRow> {
    if (this.failCreate) throw this.failCreate;
    const row = reservationRow({
      res_id: String(++this.seq), res_uuid: data.uuid, res_codigo: data.codigo, ord_numero: data.ordNumero, det_id: String(data.detId), dis_id: String(data.disId),
      gui_id: data.guiId === null ? null : String(data.guiId), est_codigo: 'PENDING', res_adultos: data.adultos, res_ninos: data.ninos, res_seniors: data.seniors,
      res_infantes: data.infantes, res_numero_tickets: data.adultos + data.ninos + data.seniors + data.infantes, res_precio_total: data.total.toFixed(2),
      res_voucher_qr: data.voucher, cla_id_cliente: data.claIdCliente === null ? null : String(data.claIdCliente), res_canal: data.canal,
      pax_nombre: data.customer.nombre, pax_tipo_documento: data.customer.tipoDocumento, pax_documento: data.customer.documento,
      pax_correo: data.customer.correo, pax_telefono: data.customer.telefono,
    });
    this.rows.set(row.res_id, row);
    this.events.push(...events);
    return row;
  }

  readonly transitionCalls: { resId: string; from: ReservationState[]; to: ReservationState; sets: Record<string, unknown> }[] = [];

  async transition(resId: string, from: ReservationState[], to: ReservationState, sets: Record<string, unknown>, events: (row: ReservationRow) => OutgoingEvent[], within?: (m: EntityManager, row: ReservationRow) => Promise<void>): Promise<ReservationRow | null> {
    this.transitionCalls.push({ resId, from, to, sets });
    const row = this.rows.get(resId);
    if (!row || !from.includes(row.est_codigo)) return null;
    const updated: ReservationRow = { ...row, est_codigo: to };
    for (const [column, value] of Object.entries(sets)) (updated as unknown as Record<string, unknown>)[column] = value instanceof Date || value === null ? value : typeof value === 'number' ? String(value) : value;
    this.rows.set(resId, updated);
    this.events.push(...events(updated));
    if (within) await within({} as EntityManager, updated);
    return this.rows.get(resId)!;
  }

  async recordRefund(ordNumero: string, reembolsoId: string, monto: number): Promise<void> {
    const row = await this.findByOrder(ordNumero);
    if (row) this.rows.set(row.res_id, { ...row, res_reembolso_id: reembolsoId, res_monto_reembolsado: String(monto) });
  }

  async byState(state: ReservationState): Promise<ReservationRow[]> {
    return [...this.rows.values()].filter((r) => r.est_codigo === state);
  }

  eventTypes(): string[] {
    return this.events.map((e) => e.tipo);
  }

  asRepository(): ReservationRepository {
    return this as unknown as ReservationRepository;
  }
}

/** Fake de IdempotencyRepository con las mismas reglas: DONE repite, otro hash es `reused`, IN_PROGRESS bloquea, FAILED permite reintentar. */
export class FakeIdempotency {
  readonly entries = new Map<string, { hash: string; estado: 'IN_PROGRESS' | 'DONE' | 'FAILED'; response?: unknown }>();
  purged = 0;

  private key = (clave: string, s: IdempotencySubject) => `${s.tipo}:${s.id}:${clave}`;

  async reserve<T>(clave: string, subject: IdempotencySubject, _operacion: string, hash: string): Promise<Reservation<T>> {
    const k = this.key(clave, subject);
    const existing = this.entries.get(k);
    if (!existing || (existing.hash === hash && existing.estado === 'FAILED')) {
      this.entries.set(k, { hash, estado: 'IN_PROGRESS' });
      return { state: 'new' };
    }
    if (existing.hash !== hash) return { state: 'reused' };
    return existing.estado === 'DONE' ? { state: 'done', response: existing.response as T } : { state: 'in_progress' };
  }

  async complete(clave: string, subject: IdempotencySubject, response: unknown): Promise<void> {
    const entry = this.entries.get(this.key(clave, subject))!;
    entry.estado = 'DONE';
    entry.response = JSON.parse(JSON.stringify(response));
  }

  async fail(clave: string, subject: IdempotencySubject): Promise<void> {
    this.entries.get(this.key(clave, subject))!.estado = 'FAILED';
  }

  async purgeExpired(): Promise<void> {
    this.purged += 1;
  }

  asRepository(): IdempotencyRepository {
    return this as unknown as IdempotencyRepository;
  }
}

export const SLOT = { dis_id: 50, atraccion_id: 'PRhu4UBTWPBC', slot_id: 'slot-20261125-1030', fecha: '2026-11-25', hora: '10:30:00' };
export const LOGISTICS = { atraccion_id: 'PRhu4UBTWPBC', nombre: 'Tour Baños', punto_encuentro: 'Parque central', free_cancellation: true, deadline_hours: 24, guia: { gui_id: 4, nombre: 'Carlos' } };

/** Spy de Remote: cada llamada al ESB es un `jest.fn` con una respuesta por defecto del camino feliz. */
export function remoteSpy() {
  const spy = {
    reference: jest.fn(async (id: string) => ({ atr_id: 7, id, nombre: 'Tour Baños' })),
    logistics: jest.fn(async (_id: string, _guiId: number | null) => LOGISTICS),
    logisticsOrNull: jest.fn(async (_id: string, _guiId: number | null) => LOGISTICS as typeof LOGISTICS | null),
    reservationLogistics: jest.fn(async (_id: string, _guiId: string | null) => LOGISTICS as typeof LOGISTICS | null),
    assertOperatorOf: jest.fn(async (_id: string) => undefined),
    createOrder: jest.fn(async (_input: object) => ({ ord_id: 11, ord_numero: 'ORD-11', det_id_adulto: 21, total: 90 })),
    startPayment: jest.fn(async (_ordNumero: string, _tarjeta: unknown) => ({ estado_pago: 'APROBADO' })),
    cancelOrder: jest.fn(async (_ordNumero: string, _motivo: string) => ({}) as unknown),
    order: jest.fn(async (ref: { ord_id?: number; ord_numero?: string }) => ({ orden: { ord_id: ref.ord_id ?? 11, ord_numero: ref.ord_numero ?? 'ORD-11', det_id_adulto: 21, total: 90 }, usu_id: 3, cla_id: 9 })),
    myOrders: jest.fn(async (_page: number, _limit: number) => ({ total_results: 0, items: [] as { ord_numero: string }[] })),
    reserveSeats: jest.fn(async (_atraccionId: string, _slotId: string, _cantidad: number, _clave: string) => ({ dis_id: 50, cupos_disponibles: 8, gui_id: null as number | null })),
    releaseSeats: jest.fn(async (_clave: string) => ({ cupos_disponibles: 10 })),
    slot: jest.fn(async (_disId: number) => SLOT),
    slots: jest.fn(async (ids: number[]) => ids.map((id) => ({ ...SLOT, dis_id: id }))),
    ensureClient: jest.fn(async (_customer: object) => 77),
    notifyCheckin: jest.fn(async (_payload: object) => ({}) as unknown),
    refund: jest.fn(async (_ordId: number, _motivo: string, _clave: string) => ({ reembolso_id: 'RF-1', monto_reembolsado: 90 }) as { reembolso_id: string; monto_reembolsado: number } | null),
  };
  return { spy, remote: spy as unknown as Remote };
}

export function purchaseInput(overrides: Partial<PurchaseInput> = {}): PurchaseInput {
  return {
    idempotencyKey: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    attractionId: 'PRhu4UBTWPBC',
    slotId: 'slot-20261125-1030',
    date: '2026-11-25',
    adultos: 2,
    ninos: 0,
    seniors: 0,
    infantes: 0,
    requerimientos: null,
    customer: { nombre: 'Ana Pérez', correo: 'ana@correo.com', telefono: '0991234567', tipoDocumento: 'CEDULA', documento: '1710034065' },
    metodo: 'CREDIT_CARD',
    sagaId: null,
    cartItemId: null,
    couponCode: null,
    tarjeta: null,
    ...overrides,
  };
}

/** Fake de los avisos del check-in. */
export class FakeNotifications {
  readonly inserted: { resId: string; payload: CheckinNotificationPayload }[] = [];
  readonly sent: string[] = [];
  readonly failed: string[] = [];
  pending: { res_id: string; nch_payload: CheckinNotificationPayload; nch_intentos: number; nch_correlation_id: string | null }[] = [];

  async insert(_m: EntityManager, resId: string, payload: CheckinNotificationPayload): Promise<void> {
    this.inserted.push({ resId, payload });
  }

  async claim(): Promise<typeof this.pending> {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  async markSent(resId: string): Promise<void> {
    this.sent.push(resId);
  }

  async markFailed(resId: string): Promise<number> {
    this.failed.push(resId);
    return this.failed.length;
  }

  asRepository(): CheckinNotificationRepository {
    return this as unknown as CheckinNotificationRepository;
  }
}

export const notifierSpy = () => ({ send: jest.fn(async () => undefined) }) as unknown as CheckinNotifier & { send: jest.Mock };
