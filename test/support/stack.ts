import type { INestApplication } from '@nestjs/common';
import { createLogger, createRpcHttpService, InMemoryEventBus, listen, OutboxRelay, type EventBus, type RunningServer } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import { createEsb, readEsbConfig, type EsbConfig } from '../../apps/esb/src';
import { createGateway } from '../../apps/gateway/src';
import { createPartnerApi, readPartnerApiConfig } from '../../apps/partner-api/src';
import { EventPublisher } from '../../apps/services/ms-booking/src/application/event-publisher';
import { EVENT_PATTERNS as BOOKING_PATTERNS, EVENT_QUEUE as BOOKING_QUEUE } from '../../apps/services/ms-booking/src/application/payment-events';
import { createMsBookingService, readMsBookingConfig } from '../../apps/services/ms-booking/src';
import { EVENT_PATTERNS as CATALOG_PATTERNS, EVENT_QUEUE as CATALOG_QUEUE } from '../../apps/services/ms-catalog/src/application/event-handlers';
import { createMsBillingProfileService, readMsBillingProfileConfig } from '../../apps/services/ms-billing-profile/src';
import { createMsCatalogService, readMsCatalogConfig } from '../../apps/services/ms-catalog/src';
import { createMsCouponService, readMsCouponConfig } from '../../apps/services/ms-coupon/src';
import { createMsIdentityService, readMsIdentityConfig } from '../../apps/services/ms-identity/src';
import { createMsInventoryService, readMsInventoryConfig, STOCK_EVENT } from '../../apps/services/ms-inventory/src';
import { createMsLocationService, readMsLocationConfig } from '../../apps/services/ms-location/src';
import { EVENT_PATTERNS as ORDER_PATTERNS, EVENT_QUEUE as ORDER_QUEUE } from '../../apps/services/ms-order/src/application/payment-events';
import { CART_SYNC_EVENT, createMsOrderService, readMsOrderConfig } from '../../apps/services/ms-order/src';
import { createMsPaymentService, readMsPaymentConfig } from '../../apps/services/ms-payment/src';
import { createMsPricingService, readMsPricingConfig } from '../../apps/services/ms-pricing/src';
import { createMsRefundService, readMsRefundConfig } from '../../apps/services/ms-refund/src';
import { createMsReviewService, readMsReviewConfig } from '../../apps/services/ms-review/src';
import { msDatabase, type MsDatabase, type MsServiceName } from './db';

/** Secretos fijos de la suite: nunca se leen del entorno ni de Azure. */
export const SECRETS = {
  internal: 'secreto-interno-de-pruebas-con-mas-de-32-caracteres',
  service: 'token-de-servicio-de-pruebas-con-32-caracteres-x',
  jwt: 'secreto-jwt-de-pruebas-con-mas-de-32-caracteres-aa',
  voucher: 'secreto-del-voucher-de-pruebas-con-32-caracteres',
  webhook: 'secreto-del-webhook-de-pruebas-con-32-caracteres-x',
};

/** Destino del ESB de cada microservicio del alcance. */
const TARGET: Record<MsServiceName, keyof EsbConfig['targets']> = {
  'ms-catalog': 'catalog', 'ms-inventory': 'inventory', 'ms-booking': 'booking', 'ms-coupon': 'coupon', 'ms-identity': 'identity', 'ms-order': 'order',
  'ms-pricing': 'pricing', 'ms-payment': 'payment', 'ms-refund': 'refund', 'ms-location': 'location', 'ms-billing-profile': 'billing', 'ms-review': 'review',
};

export const ALL_SERVICES = Object.keys(TARGET) as MsServiceName[];

export interface StackOptions {
  /** Servicios a levantar (por defecto los 12). */
  services?: MsServiceName[];
  /** Bus real (RabbitMQ local) o, por defecto, el bus en memoria. */
  bus?: EventBus;
  /** Levanta también Partner API y Gateway (`gatewayUrl`). */
  edge?: boolean;
  /** Servicios críticos de la salud agregada (P13). */
  healthCritical?: string[];
  /** Destinos del ESB reemplazados por un doble HTTP (servicios que no participan). */
  doubles?: Partial<Record<keyof EsbConfig['targets'], string>>;
}

export interface Stack {
  esbUrl: string;
  esbConfig: EsbConfig;
  gatewayUrl: string;
  partnerApiUrl: string;
  bus: EventBus;
  db: Partial<Record<MsServiceName, MsDatabase>>;
  urls: Partial<Record<MsServiceName, string>>;
  /** Publica el outbox de todos los servicios con relay (y el de Booking) y espera a los consumidores en memoria. */
  pumpEvents(): Promise<void>;
  /** Detiene un servicio (salud DOWN, compensaciones). */
  stop(service: MsServiceName): Promise<void>;
  close(): Promise<void>;
}

/**
 * Sistema en proceso con los componentes de la sección 0.2 del inventario: cada `ms-*` con su base `ms_*` migrada, el
 * ESB y, si se pide, la Partner API y el Gateway. Los servicios heredados y `booking-mock` no se levantan.
 */
export async function startStack(options: StackOptions = {}): Promise<Stack> {
  process.env.LOG_SILENT = process.env.SYSTEM_TEST_LOGS === 'true' ? 'false' : 'true';
  // EsbClient toma SERVICE_TOKEN del entorno al crearse: se fija el de la suite antes de crear los servicios.
  process.env.SERVICE_TOKEN = SECRETS.service;
  const services = options.services ?? ALL_SERVICES;
  const bus = options.bus ?? new InMemoryEventBus();
  const logger = createLogger('stack');
  const servers: Partial<Record<MsServiceName, RunningServer>> = {};
  const extra: RunningServer[] = [];
  const db: Stack['db'] = {};
  const urls: Stack['urls'] = {};
  const relays: OutboxRelay[] = [];
  let bookingPublisher: EventPublisher | null = null;
  let gatewayApp: INestApplication | null = null;

  // 1. ESB primero: los servicios necesitan su URL; los destinos se completan cuando cada servicio ya escucha.
  const esbConfig: EsbConfig = { ...readEsbConfig({ SERVICE_TOKEN: SECRETS.service }), targets: { ...(options.doubles ?? {}) } };
  const esb = createEsb(esbConfig);
  const esbServer = await listen(esb.app, 0, '127.0.0.1');
  const env = {
    INTERNAL_TOKEN_SECRET: SECRETS.internal, SERVICE_TOKEN: SECRETS.service, JWT_SECRET: SECRETS.jwt, VOUCHER_SECRET: SECRETS.voucher,
    WEBHOOK_SECRET: SECRETS.webhook, ESB_URL: esbServer.url, BASE_PATH: '/api/v3', BOOKING_SYNC_ENABLED: 'false',
  } as NodeJS.ProcessEnv;
  const rpc = (service: MsServiceName, ds: DataSource, definition: never, implementation: never) =>
    createRpcHttpService({ service, definition, implementation, serviceToken: SECRETS.service, dataSource: ds, logger });

  for (const service of services) {
    const database = await msDatabase(service);
    db[service] = database;
    const ds = database.dataSource;
    let app;
    switch (service) {
      case 'ms-catalog': {
        const catalog = createMsCatalogService(readMsCatalogConfig(env), ds, { logger });
        await bus.subscribe(CATALOG_QUEUE, CATALOG_PATTERNS, catalog.onEvent);
        app = catalog.app;
        break;
      }
      case 'ms-inventory': {
        const inventory = createMsInventoryService(readMsInventoryConfig(env), ds, { logger });
        relays.push(new OutboxRelay(ds, bus, 'inventory', { logger, excludeTypes: [STOCK_EVENT] }));
        app = rpc(service, ds, inventory.definition as never, inventory.implementation as never);
        break;
      }
      case 'ms-booking': {
        const booking = createMsBookingService(readMsBookingConfig(env), ds, { logger });
        await bus.subscribe(BOOKING_QUEUE, BOOKING_PATTERNS, booking.onEvent);
        bookingPublisher = new EventPublisher(ds, booking.events, bus, logger);
        app = rpc(service, ds, booking.definition as never, booking.implementation as never);
        break;
      }
      case 'ms-order': {
        const order = createMsOrderService(readMsOrderConfig(env), ds, { logger });
        await bus.subscribe(ORDER_QUEUE, ORDER_PATTERNS, order.onEvent);
        relays.push(new OutboxRelay(ds, bus, 'order', { logger, excludeTypes: [CART_SYNC_EVENT] }));
        app = rpc(service, ds, order.definition as never, order.implementation as never);
        break;
      }
      case 'ms-pricing': {
        const pricing = createMsPricingService(readMsPricingConfig(env), ds, { logger });
        relays.push(new OutboxRelay(ds, bus, 'pricing', { logger }));
        app = rpc(service, ds, pricing.definition as never, pricing.implementation as never);
        break;
      }
      case 'ms-payment': {
        const payment = createMsPaymentService(readMsPaymentConfig(env), ds, { bus, logger });
        relays.push(new OutboxRelay(ds, bus, 'payment', { logger }));
        app = payment.app;
        break;
      }
      case 'ms-identity':
        app = createMsIdentityService(readMsIdentityConfig(env), ds, { logger }).app;
        break;
      case 'ms-coupon':
        app = createMsCouponService(readMsCouponConfig(env), ds, { logger });
        break;
      case 'ms-refund':
        app = createMsRefundService(readMsRefundConfig(env), ds, { logger });
        relays.push(new OutboxRelay(ds, bus, 'refund', { logger }));
        break;
      case 'ms-location':
        app = await createMsLocationService(readMsLocationConfig(env), ds, { logger });
        break;
      case 'ms-billing-profile':
        app = createMsBillingProfileService(readMsBillingProfileConfig(env), ds, { logger });
        break;
      case 'ms-review':
        app = createMsReviewService(readMsReviewConfig(env), ds, { logger });
        relays.push(new OutboxRelay(ds, bus, 'review', { logger }));
        break;
    }
    const server = await listen(app!, 0, '127.0.0.1');
    servers[service] = server;
    urls[service] = server.url;
    esbConfig.targets[TARGET[service]] = server.url;
  }

  let partnerApiUrl = '';
  let gatewayUrl = '';
  if (options.edge) {
    const partnerConfig = {
      ...readPartnerApiConfig({ INTERNAL_TOKEN_SECRET: SECRETS.internal, ESB_URL: esbServer.url, VALIDATE_RESPONSES: 'true' }),
      health: { critical: options.healthCritical ?? ['catalog', 'pricing', 'inventory', 'order', 'booking', 'payment'], optional: ['refund'], cacheMs: 0, timeoutMs: 1500 },
    };
    const partner = createPartnerApi(partnerConfig);
    partner.nodeHealth.watch(bus);
    const partnerServer = await listen(partner.app, 0, '127.0.0.1');
    extra.push(partnerServer);
    partnerApiUrl = partnerServer.url;
    gatewayApp = await createGateway({
      port: 0,
      upstreams: { partnerApi: partnerServer.url, identity: urls['ms-identity'] ?? partnerServer.url, esb: esbServer.url, graphql: null },
      internalTokenSecret: SECRETS.internal,
      corsOrigins: [],
      rateLimitPerMinute: 10_000,
      apiKeyCacheMs: 60_000,
      tokenCacheMs: 30_000,
    });
    await gatewayApp.listen(0, '127.0.0.1');
    gatewayUrl = (await gatewayApp.getUrl()).replace('[::1]', '127.0.0.1');
  }

  return {
    esbUrl: esbServer.url,
    esbConfig,
    gatewayUrl,
    partnerApiUrl,
    bus,
    db,
    urls,
    async pumpEvents() {
      for (let round = 0; round < 3; round++) {
        for (const relay of relays) await relay.publishPending();
        if (bookingPublisher) {
          bookingPublisher.start();
          await new Promise((r) => setTimeout(r, 600));
          bookingPublisher.stop();
        }
        if (bus instanceof InMemoryEventBus) await bus.drain();
      }
    },
    async stop(service) {
      await servers[service]?.close();
      delete servers[service];
    },
    async close() {
      await gatewayApp?.close();
      for (const server of extra) await server.close();
      for (const server of Object.values(servers)) await server?.close();
      esb.router.close();
      await esbServer.close();
      for (const database of Object.values(db)) await database?.drop();
    },
  };
}
