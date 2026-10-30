import {
  addDays,
  AppError,
  asService,
  BUSINESS_TIME_ZONE,
  checkHealth,
  createLogger,
  EsbClient,
  errorFields,
  IdempotencyStore,
  isAdmin,
  loadProto,
  optionalText,
  paging,
  requirePrincipal,
  serviceConstructor,
  todayIn,
  unary,
  type DatabaseSettings,
  type grpc,
  type Logger,
} from '@atracciones/platform';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
import type { DataSource } from 'typeorm';
import { CancellationSaga, type CancelOrderInput } from './application/cancellation-saga';
import { PurchaseSaga, type CreateOrderInput } from './application/purchase-saga';
import { OrderRepository } from './persistence/order-repository';

export interface OrderConfig {
  grpcPort: number;
  database: DatabaseSettings;
  esbUrl: string;
  internalTokenSecret: string;
  timeZone: string;
  /** Una saga sin avanzar por más de estos segundos se considera abandonada y se compensa. */
  stuckSagaSeconds: number;
}

export function readOrderConfig(env: NodeJS.ProcessEnv = process.env): OrderConfig {
  return {
    grpcPort: Number(env.GRPC_PORT ?? 50065),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/order_db', ssl: env.DATABASE_SSL === 'true' },
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    timeZone: env.APP_TIMEZONE ?? BUSINESS_TIME_ZONE,
    stuckSagaSeconds: Number(env.STUCK_SAGA_SECONDS ?? 60),
  };
}

export interface OrderService {
  definition: grpc.ServiceDefinition;
  implementation: grpc.UntypedServiceImplementation;
  purchase: PurchaseSaga;
  repository: OrderRepository;
  /** Compensa las sagas abandonadas (lo ejecuta un temporizador en `main`). */
  recoverStuckSagas(): Promise<number>;
}

/** Order Management Service (gRPC, plan §3.5): orquesta las sagas de compra y de cancelación. */
export function createOrderService(config: OrderConfig, dataSource: DataSource, logger: Logger = createLogger('order')): OrderService {
  const esb = new EsbClient(config.esbUrl, 10_000);
  const orders = new OrderRepository(dataSource);
  const idempotency = new IdempotencyStore(dataSource);
  const purchase = new PurchaseSaga(esb, orders, idempotency, logger, config.timeZone);
  const cancellation = new CancellationSaga(esb, orders, idempotency, logger);
  const service = serviceConstructor(loadProto('internal/order.proto'), 'atracciones.order.OrderService');

  const implementation: grpc.UntypedServiceImplementation = {
    Health: unary('Health', async () => checkHealth('order', dataSource), logger),
    CreateOrder: unary<CreateOrderInput, object>('CreateOrder', async (req) => {
      if (!req.idempotency_key) throw AppError.validation('Falta la Idempotency-Key.', undefined, 'MISSING_IDEMPOTENCY_KEY');
      return purchase.run(await requirePrincipal(config.internalTokenSecret), {
        ...req,
        boletos: req.boletos ?? [],
        passengers: req.passengers ?? [],
      });
    }, logger),
    CancelReservation: unary<CancelOrderInput, object>('CancelReservation', async (req) => {
      if (!req.idempotency_key) throw AppError.validation('Falta la Idempotency-Key.', undefined, 'MISSING_IDEMPOTENCY_KEY');
      return cancellation.run(await requirePrincipal(config.internalTokenSecret), req);
    }, logger),

    GetOrder: unary<{ id: string }, object>('GetOrder', async (req) => {
      const who = await requirePrincipal(config.internalTokenSecret);
      const orden = await orders.summary(req.id);
      if (!orden) throw AppError.notFound(`No existe la orden '${req.id}'.`, 'ORDER_NOT_FOUND');
      if (!isAdmin(who) && (orden.principal_tipo !== who.tipo || orden.principal_id !== who.id)) throw AppError.forbidden('La orden pertenece a otro cliente.');
      // El dueño ya se verificó: pagos y comprobantes se leen con la cuenta de servicio de Order. Si Invoicing no responde,
      // la orden se muestra igual (la factura se emite de forma asíncrona).
      const [lineas, pasos, pagos, facturas] = await Promise.all([
        orders.lines(orden.id),
        orders.steps(orden.id),
        asService('order', config.internalTokenSecret, () => esb.call<object[]>('payment', 'listOrderPayments', { orden_id: orden.id })),
        asService('order', config.internalTokenSecret, () => esb.call<object[]>('invoicing', 'listInvoices', { orden_id: orden.id }, { timeoutMs: 2000 })).catch((error: unknown) => {
          logger.warn('no se pudieron leer los comprobantes de la orden', { orden_id: orden.id, ...errorFields(error) });
          return [];
        }),
      ]);
      return { orden, lineas, pasos, pagos, facturas };
    }, logger),

    ListOrders: unary<Record<string, unknown>, object>('ListOrders', async (req) => {
      const who = await requirePrincipal(config.internalTokenSecret);
      if (req.todas && !isAdmin(who)) throw AppError.forbidden('Solo un administrador puede listar todas las órdenes.');
      return orders.list({
        principal: req.todas ? null : { tipo: who.tipo, id: who.id },
        estado: optionalText(req.estado), desde: optionalText(req.desde), hasta: optionalText(req.hasta), search: optionalText(req.search),
        metodo: optionalText(req.metodo_pago), timeZone: config.timeZone, ...paging(req, 20, 100),
      });
    }, logger),

    SalesReport: unary<{ desde: string; hasta: string }, object>('SalesReport', async (req) => {
      const who = await requirePrincipal(config.internalTokenSecret);
      if (!isAdmin(who)) throw AppError.forbidden('Solo un administrador puede ver el reporte de ventas.');
      const hasta = optionalText(req.hasta) ?? todayIn(config.timeZone);
      const desde = optionalText(req.desde) ?? addDays(hasta, -30);
      if (!DATE.test(desde) || !DATE.test(hasta) || hasta < desde) {
        throw AppError.validation('Rango de fechas inválido.', [{ name: 'hasta', reason: 'Fechas YYYY-MM-DD con hasta igual o posterior a desde.' }]);
      }
      return { desde, hasta, ...(await orders.salesReport(desde, hasta, config.timeZone)) };
    }, logger),
  };

  return {
    definition: service.service,
    implementation,
    purchase,
    repository: orders,
    async recoverStuckSagas() {
      let recovered = 0;
      for (const order of await orders.stuckSagas(config.stuckSagaSeconds)) {
        try {
          if (order.estado === 'CONFIRMADA') {
            // Cancelación interrumpida de una compra ya cobrada: se termina (cancelar, liberar y reembolsar).
            const full = await orders.findByExternalId(order.codigo_externo);
            await cancellation.compensate(order.id, order.codigo_externo, full?.total ?? 0, 'Cancelación completada por recuperación', 'ADMIN');
            recovered++;
          } else if (await purchase.compensate(order.id, order.codigo_externo, 'Saga abandonada (recuperación)', ['EMITIR_RESERVA', 'REGISTRAR_PAGO', 'RESERVAR_CUPOS'])) {
            // Compra interrumpida: sin saber qué alcanzó a ejecutarse, se compensan todos los pasos (son idempotentes).
            recovered++;
          }
        } catch (error) {
          logger.warn('no se pudo recuperar la saga', { orden_id: order.id, ...errorFields(error) });
        }
      }
      return recovered;
    },
  };
}
