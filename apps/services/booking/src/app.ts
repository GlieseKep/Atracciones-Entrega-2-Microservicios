import { SignJWT } from 'jose';
import {
  AppError,
  BUSINESS_TIME_ZONE,
  checkHealth,
  createLogger,
  currentContext,
  currentPrincipal,
  ESTADOS_RESERVA,
  IdempotencyStore,
  isAdmin,
  optionalText,
  paging,
  todayIn,
  loadProto,
  serviceConstructor,
  unary,
  type DatabaseSettings,
  type grpc,
  type Logger,
  type Principal,
} from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import { BookingRepository, type CustomerData, type PassengerData, type ReservationRecord, type Ticket } from './persistence/booking-repository';

export interface BookingConfig {
  grpcPort: number;
  database: DatabaseSettings;
  internalTokenSecret: string;
  /** Firma del voucher QR (`voucher_qr_payload`). */
  voucherSecret: string;
  timeZone: string;
}

export function readBookingConfig(env: NodeJS.ProcessEnv = process.env): BookingConfig {
  return {
    grpcPort: Number(env.GRPC_PORT ?? 50066),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/booking_db', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    voucherSecret: env.VOUCHER_SECRET ?? env.INTERNAL_TOKEN_SECRET ?? '',
    timeZone: env.APP_TIMEZONE ?? BUSINESS_TIME_ZONE,
  };
}

/** Reserva en el formato del proto `atracciones.booking.Reservation`. */
export interface ReservationMessage {
  reservation_id: string;
  reservation_code: string;
  external_order_id: string;
  status: string;
  atraccion_codigo: string;
  fecha: string;
  hora: string;
  boletos: Ticket[];
  total: number;
  moneda: string;
  customer: CustomerData;
  passengers: PassengerData[];
  guia_codigo: string;
  punto_encuentro: string;
  observaciones: string;
  voucher_qr_payload: string;
  cancelable_hasta: string;
  checkin_en: string;
  checkin_documento: string;
  cancelado_en: string;
  reembolso_codigo: string;
  monto_reembolsado: number;
  principal_tipo: string;
  principal_id: string;
  creado_en: string;
  cancelacion_motivo: string;
  cancelacion_solicitante: string;
}

/**
 * Voucher QR: JWT HS256 con `{res_id, pnr, doc}`, sin fecha de emisión para que sea determinista (la misma reserva
 * produce siempre el mismo voucher, y una respuesta repetida por idempotencia es idéntica).
 */
export function signVoucher(record: Pick<ReservationRecord, 'id' | 'codigo_pnr' | 'titular_numero_documento'>, secret: string): Promise<string> {
  return new SignJWT({ res_id: record.id, pnr: record.codigo_pnr, doc: record.titular_numero_documento })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(new TextEncoder().encode(secret));
}

export async function toMessage(r: ReservationRecord, voucherSecret: string): Promise<ReservationMessage> {
  return {
    reservation_id: r.id,
    reservation_code: r.codigo_pnr,
    external_order_id: r.codigo_externo_orden,
    status: r.estado,
    atraccion_codigo: r.atraccion_codigo,
    fecha: r.fecha,
    hora: r.hora,
    boletos: r.boletos,
    total: r.total,
    moneda: r.moneda,
    customer: {
      full_name: r.titular_nombre, email: r.titular_email, phone: r.titular_telefono, document_type: r.titular_tipo_documento, document_id: r.titular_numero_documento,
    },
    passengers: r.pasajeros,
    guia_codigo: r.guia_codigo,
    punto_encuentro: r.punto_encuentro,
    observaciones: r.observaciones ?? '',
    voucher_qr_payload: await signVoucher(r, voucherSecret),
    cancelable_hasta: r.cancelable_hasta ?? '',
    checkin_en: r.checkin?.realizado_en ?? '',
    checkin_documento: r.checkin?.documento_presentado ?? '',
    cancelado_en: r.cancelacion?.cancelado_en ?? '',
    reembolso_codigo: r.cancelacion?.reembolso_codigo ?? '',
    monto_reembolsado: r.cancelacion?.monto_reembolsado ?? 0,
    principal_tipo: r.principal_tipo,
    principal_id: r.principal_id,
    creado_en: r.creado_en,
    cancelacion_motivo: r.cancelacion?.motivo ?? '',
    cancelacion_solicitante: r.cancelacion?.solicitante ?? '',
  };
}

/** Puede ver o modificar la reserva: su dueño (usuario o socio que la creó) o un administrador. */
export function assertAccess(r: ReservationRecord, principal: Principal | null): void {
  if (!principal) throw AppError.unauthorized();
  const owner = r.principal_tipo === principal.tipo && r.principal_id === principal.id;
  if (!owner && !principal.scopes.includes('attractions:write')) {
    throw AppError.forbidden('La reserva pertenece a otro cliente.');
  }
}

export interface BookingService {
  definition: grpc.ServiceDefinition;
  implementation: grpc.UntypedServiceImplementation;
  repository: BookingRepository;
}

/** Booking Service (gRPC, plan §3.6). */
export function createBookingService(config: BookingConfig, dataSource: DataSource, logger: Logger = createLogger('booking')): BookingService {
  if (config.voucherSecret.length < 32) throw new Error('VOUCHER_SECRET (o INTERNAL_TOKEN_SECRET) debe tener al menos 32 caracteres.');
  const repository = new BookingRepository(dataSource);
  const service = serviceConstructor(loadProto('internal/booking.proto'), 'atracciones.booking.BookingService');
  const principal = () => currentPrincipal(config.internalTokenSecret);
  const notFound = (id: string) => AppError.notFound(`No existe la reserva '${id}'.`, 'RESERVATION_NOT_FOUND');
  const idempotency = new IdempotencyStore(dataSource);

  const implementation: grpc.UntypedServiceImplementation = {
    Health: unary('Health', async () => checkHealth('booking', dataSource), logger),

    CreateReservation: unary<Record<string, unknown>, ReservationMessage>('CreateReservation', async (req) => {
      const record = await repository.create({
        externalOrderId: String(req.external_order_id),
        principalTipo: String(req.principal_tipo),
        principalId: String(req.principal_id),
        atraccionCodigo: String(req.atraccion_codigo),
        fecha: String(req.fecha),
        hora: String(req.hora),
        boletos: (req.boletos as Ticket[]) ?? [],
        total: Number(req.total),
        moneda: String(req.moneda || 'USD'),
        customer: req.customer as CustomerData,
        passengers: (req.passengers as PassengerData[]) ?? [],
        guiaCodigo: String(req.guia_codigo ?? ''),
        puntoEncuentro: String(req.punto_encuentro),
        cancelableHasta: req.cancelable_hasta ? String(req.cancelable_hasta) : null,
        observaciones: req.observaciones ? String(req.observaciones) : null,
      });
      return toMessage(record, config.voucherSecret);
    }, logger),

    GetReservation: unary<{ id: string }, ReservationMessage>('GetReservation', async (req) => {
      const record = await repository.find(req.id);
      if (!record) throw notFound(req.id);
      assertAccess(record, await principal());
      return toMessage(record, config.voucherSecret);
    }, logger),

    /** Cancelación (plan §5.2): solo el cliente está sujeto al plazo de cancelación gratuita. */
    CancelReservation: unary<{ id: string; motivo: string; solicitante: string; reembolso_codigo: string; monto_reembolsado: number; solo_validar: boolean }, ReservationMessage>(
      'CancelReservation',
      async (req) => {
        const who = await principal();
        const solicitante = req.solicitante || 'CLIENTE';
        const record = await repository.cancel(
          req.id,
          { motivo: req.motivo || `Cancelación solicitada por ${solicitante}`, solicitante, reembolsoCodigo: req.reembolso_codigo || null, montoReembolsado: req.monto_reembolsado ?? null, soloValidar: req.solo_validar },
          (r) => {
            assertAccess(r, who);
            if (r.estado === 'CANCELLED') return;
            if (r.estado !== 'CONFIRMED' && r.estado !== 'PENDING') {
              throw AppError.conflict('INVALID_STATE_TRANSITION', `No se puede cancelar una reserva en estado ${r.estado}.`);
            }
            if (solicitante === 'CLIENTE' && (!r.cancelable_hasta || Date.now() > Date.parse(r.cancelable_hasta))) {
              throw AppError.conflict('CANCELLATION_DEADLINE_PASSED', r.cancelable_hasta
                ? `El plazo de cancelación gratuita venció el ${r.cancelable_hasta}.`
                : 'La reserva no admite cancelación gratuita.');
            }
          },
        );
        if (!record) throw notFound(req.id);
        return toMessage(record, config.voucherSecret);
      },
      logger,
    ),

    /** Check-in presencial (plan §5.3), idempotente por `Idempotency-Key`: un reintento devuelve el mismo pase. */
    CheckIn: unary<{ id: string; documento_identidad: string; codigo_voucher_qr: string; guia_codigo: string; scanner_device_id: string }, ReservationMessage>('CheckIn', async (req) => {
      const who = await principal();
      if (!who) throw AppError.unauthorized();
      const key = currentContext()?.idempotencyKey;
      if (!key) throw AppError.validation('Falta la Idempotency-Key.', undefined, 'MISSING_IDEMPOTENCY_KEY');
      const start = await idempotency.begin<ReservationMessage>(who, 'checkin', key, req);
      if ('replay' in start) return start.replay.body;
      try {
        const today = todayIn(config.timeZone);
        const record = await repository.checkIn(req.id, { documento: req.documento_identidad, guiaCodigo: req.guia_codigo || null, dispositivo: req.scanner_device_id || null }, async (r) => {
          const guide = who.tipo === 'USUARIO' && who.scopes.includes('attractions:checkin');
          if (!guide) assertAccess(r, who);
          if (r.estado === 'CHECKED_IN') throw AppError.conflict('ALREADY_CHECKED_IN', 'La reserva ya tiene check-in con otra Idempotency-Key.');
          if (r.estado !== 'CONFIRMED') throw AppError.conflict('INVALID_STATE_TRANSITION', `No se puede hacer check-in de una reserva en estado ${r.estado}.`);
          const documentos = [r.titular_numero_documento, ...r.pasajeros.map((p) => p.document_id)].filter(Boolean).map((d) => d.toUpperCase());
          if (!documentos.includes(req.documento_identidad.trim().toUpperCase())) {
            throw AppError.forbidden('El documento presentado no coincide con el titular ni con los pasajeros de la reserva.', 'IDENTITY_MISMATCH');
          }
          // El voucher, si se presenta, debe ser el PNR o el voucher firmado de esta reserva.
          const voucher = req.codigo_voucher_qr?.trim();
          if (voucher && voucher.toUpperCase() !== r.codigo_pnr && voucher !== (await signVoucher(r, config.voucherSecret))) {
            throw AppError.validation('El código QR presentado no corresponde a esta reserva.', [{ name: 'codigo_voucher_qr', reason: 'No es el PNR ni el voucher de la reserva.' }], 'INVALID_VOUCHER');
          }
          if (r.fecha !== today) throw AppError.conflict('CHECKIN_OUT_OF_WINDOW', `El check-in solo se puede hacer el día de la actividad (${r.fecha}).`);
        });
        if (!record) throw notFound(req.id);
        const message = await toMessage(record, config.voucherSecret);
        await idempotency.complete(start.recordId, { status: 200, body: message });
        return message;
      } catch (error) {
        await idempotency.abandon(start.recordId).catch(() => undefined);
        throw error;
      }
    }, logger),
  };

  implementation.ListReservations = unary<Record<string, unknown>, object>('ListReservations', async (req) => {
    const who = await principal();
    if (!who) throw AppError.unauthorized();
    if (req.todas && !isAdmin(who)) throw AppError.forbidden('Solo un administrador puede listar todas las reservas.');
    if (req.estado && !ESTADOS_RESERVA.includes(req.estado as (typeof ESTADOS_RESERVA)[number])) {
      throw AppError.validation('Estado de reserva inválido.', [{ name: 'estado', reason: `Debe ser uno de ${ESTADOS_RESERVA.join(', ')}.` }]);
    }
    const page = await repository.list({
      principal: req.todas ? null : { tipo: who.tipo, id: who.id },
      estado: optionalText(req.estado), desde: optionalText(req.fecha_desde), hasta: optionalText(req.fecha_hasta),
      codigo: optionalText(req.atraccion_codigo), search: optionalText(req.search), orden: optionalText(req.orden), ...paging(req, 20, 100),
    });
    return { total: page.total, items: await Promise.all(page.items.map((r) => toMessage(r, config.voucherSecret))) };
  }, logger);

  implementation.ReservationStats = unary<{ fecha_desde: string; fecha_hasta: string }, object>('ReservationStats', async (req) => {
    if (!isAdmin(await principal())) throw AppError.forbidden('Solo un administrador puede ver las estadísticas de reservas.');
    return repository.stats(optionalText(req.fecha_desde), optionalText(req.fecha_hasta));
  }, logger);

  return { definition: service.service, implementation, repository };
}
