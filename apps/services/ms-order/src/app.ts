import {
  checkNodeHealth,
  createLogger,
  EsbClient,
  loadProto,
  serviceConstructor,
  unary,
  type DatabaseSettings,
  type EventHandler,
  type grpc,
  type Logger,
} from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import { parseCard, parseCreateOrder, parseOrderNumber } from './application/input';
import { OrderService } from './application/order-service';
import { paymentEventHandler } from './application/payment-events';
import { PaymentFlow } from './application/payment-flow';
import { PaymentMethods } from './application/payment-methods';
import { StaleOrders } from './application/stale-orders';
import { IdempotencyRepository } from './persistence/idempotency-repository';
import { OrderRepository } from './persistence/order-repository';

export interface MsOrderConfig {
  grpcPort: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  esbUrl: string;
  nodeId: string;
  nodeCode: string;
}

export function readMsOrderConfig(env: NodeJS.ProcessEnv = process.env): MsOrderConfig {
  return {
    grpcPort: Number(env.GRPC_PORT ?? 50068),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_order', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    nodeId: env.NODE_ID ?? 'node-dilan-order-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_ORDER',
  };
}

export interface MsOrderDependencies {
  logger?: Logger;
  esb?: EsbClient;
}

export interface MsOrderService {
  definition: grpc.ServiceDefinition;
  implementation: grpc.UntypedServiceImplementation;
  onEvent: EventHandler;
  staleOrders: StaleOrders;
  esb: EsbClient;
}

const VERSION = '1.0.0';

type Message = Record<string, unknown>;

/** Order Management Service (gRPC, contrato `Plan/ms_order/order.proto`): órdenes, cupones aplicados y seguimiento del pago. */
export function createMsOrderService(config: MsOrderConfig, dataSource: DataSource, deps: MsOrderDependencies = {}): MsOrderService {
  const logger = deps.logger ?? createLogger('ms-order');
  const esb = deps.esb ?? new EsbClient(config.esbUrl);
  const orders = new OrderRepository(dataSource);
  const idempotency = new IdempotencyRepository(dataSource);
  const methods = new PaymentMethods(esb);
  const service = new OrderService(orders, idempotency, methods, esb, config.internalTokenSecret, logger);
  const flow = new PaymentFlow(orders, service, methods, esb);

  const definition = serviceConstructor(loadProto('internal/ms-order.proto'), 'descubre.order.OrderService').service;
  const rpc = (method: string, handler: (request: Message) => Promise<unknown>) => unary(method, handler, logger);

  const implementation: grpc.UntypedServiceImplementation = {
    Health: rpc('Health', () => checkNodeHealth('ms-order', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION })),
    CreateOrder: rpc('CreateOrder', (request) => service.create(parseCreateOrder(request))),
    StartPayment: rpc('StartPayment', (request) => flow.start(parseOrderNumber(request.ord_numero), parseCard(request.tarjeta))),
    CancelOrder: rpc('CancelOrder', (request) => service.cancel(parseOrderNumber(request.ord_numero), String(request.motivo ?? ''))),
    GetOrder: rpc('GetOrder', (request) => service.detail(Number(request.ord_id ?? 0), String(request.ord_numero ?? ''))),
    ListOrders: rpc('ListOrders', (request) => service.list(request.todas === true, String(request.estado ?? ''), Number(request.page ?? 0), Number(request.limit ?? 0))),
  };

  return {
    definition,
    implementation,
    onEvent: paymentEventHandler(orders, logger),
    staleOrders: new StaleOrders(orders, idempotency, service, esb, logger),
    esb,
  };
}
