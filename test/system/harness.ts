import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { InMemoryEventBus, listen, OutboxRelay, startGrpcServer, type GrpcServerHandle, type RunningServer } from '@atracciones/platform';
import { startBookingMock, type BookingMock } from '../../apps/booking-mock/src';
import { createGraphqlServer, readGraphqlConfig, type GraphqlServer } from '../../apps/graphql/src';
import { createAuditService, readAuditConfig } from '../../apps/services/audit/src';
import { createCartService, readCartConfig } from '../../apps/services/cart/src';
import { createInvoicingService, readInvoicingConfig, type InvoicingApp } from '../../apps/services/invoicing/src';
import { startSriMock, type SriMock } from '../../apps/sri-mock/src';
import { BookingStockSync, INVENTORY_SCHEMA } from '../../apps/services/inventory/src';
import type { DataSource } from 'typeorm';
import { createEsb, readEsbConfig, type Esb } from '../../apps/esb/src';
import { createGateway, readGatewayConfig } from '../../apps/gateway/src';
import { createPartnerApi, readPartnerApiConfig } from '../../apps/partner-api/src';
import { createBookingService, readBookingConfig } from '../../apps/services/booking/src';
import { createCatalogService, readCatalogConfig } from '../../apps/services/catalog/src';
import { createIdentityService, readIdentityConfig, type IdentityService } from '../../apps/services/identity/src';
import { createInventoryService, readInventoryConfig } from '../../apps/services/inventory/src';
import { createOrderService, readOrderConfig, type OrderService } from '../../apps/services/order/src';
import { createPaymentService, readPaymentConfig } from '../../apps/services/payment/src';
import { migratedDatabase, type ServiceDatabase } from '../../apps/services/test/helpers';

export const INTERNAL_SECRET = 'secreto-interno-de-pruebas-con-mas-de-32-caracteres';

type DbName = 'identity' | 'catalog' | 'inventory' | 'cart' | 'order' | 'booking' | 'payment' | 'audit' | 'invoicing';

/** Sistema completo en un proceso: cada componente real en un puerto libre y con su propia base embebida. */
export interface System {
  gatewayUrl: string;
  identity: IdentityService;
  esb: Esb;
  order?: OrderService;
  databases: Partial<Record<DbName, DataSource>>;
  bus: InMemoryEventBus;
  /** Mock de Booking Prototipo que recibe el stock por gRPC (Fase 5). */
  bookingMock?: BookingMock;
  /** Simulador SOAP del SRI (Fase 6). */
  sriMock?: SriMock;
  /** Puerto gRPC de Inventory (servicio interno y `InventoryStockService`). */
  inventoryGrpcPort?: number;
  /** GraphQL del portal (Fase 7), detrás del Gateway en `/graphql`. */
  graphql?: GraphqlServer;
  /** Publica el outbox de todos los servicios, espera a los consumidores y envía el stock a Booking. */
  pumpEvents(): Promise<void>;
  /** Detiene / reinicia un servicio gRPC (pruebas de circuit breaker, 503 y compensación). */
  stop(service: 'inventory' | 'booking'): Promise<void>;
  restart(service: 'booking'): Promise<void>;
  close(): Promise<void>;
}

export interface SystemOptions {
  /** Servicios críticos para la salud agregada (`GET /atracciones/health`). */
  healthCritical?: string[];
  rateLimitPerMinute?: number;
  /** Catalog e Inventory con el catálogo inicial (Fase 2 en adelante). */
  catalog?: boolean;
  /** Order, Payment y Booking (sagas, Fases 3 y 4). Implica `catalog`. */
  sagas?: boolean;
  /** Bus de eventos, Audit, relays del outbox y envío de stock al mock de Booking (Fase 5). Implica `sagas`. */
  events?: boolean;
  /** Cart y GraphQL del portal (Fase 7). Implica `events`. */
  portal?: boolean;
}

export async function startSystem(options: SystemOptions = {}): Promise<System> {
  process.env.LOG_SILENT = process.env.SYSTEM_TEST_LOGS === 'true' ? 'false' : 'true';
  if (options.portal) options = { ...options, events: true };
  const withSagas = options.sagas || options.events;
  const withCatalog = options.catalog || withSagas;
  const bus = new InMemoryEventBus();
  const relays: OutboxRelay[] = [];
  let stockSync: BookingStockSync | null = null;
  let bookingMock: BookingMock | undefined;
  let sriMock: SriMock | undefined;
  let invoicing: InvoicingApp | undefined;
  let graphql: GraphqlServer | undefined;
  const closers: (() => Promise<void>)[] = [];
  const grpcServers: Partial<Record<'inventory' | 'booking' | 'order', GrpcServerHandle | null>> = {};
  const databases: ServiceDatabase[] = [];
  const dataSources: System['databases'] = {};
  const database = async (name: DbName) => {
    const db = await migratedDatabase(name);
    databases.push(db);
    dataSources[name] = db.dataSource;
    return db.dataSource;
  };
  try {
    // El ESB arranca primero: los servicios que lo llaman (Order) necesitan su URL; sus destinos se completan después.
    const targets: Record<string, string> = {};
    const esb = createEsb({ ...readEsbConfig({}), targets, breaker: { errorThresholdPercentage: 50, resetTimeoutMs: 500, volumeThreshold: 3 } });
    const esbServer = await listen(esb.app, 0, '127.0.0.1');
    closers.push(async () => {
      esb.router.close();
      await esbServer.close();
    });

    const identity = await createIdentityService({ ...readIdentityConfig({}), internalTokenSecret: INTERNAL_SECRET }, await database('identity'));
    const identityServer = await listen(identity.app, 0, '127.0.0.1');
    closers.push(identityServer.close);
    targets.identity = identityServer.url;

    let bookingFactory: (() => Promise<void>) | null = null;
    let order: OrderService | undefined;
    if (withCatalog) {
      const catalog = createCatalogService({ ...readCatalogConfig({}), internalTokenSecret: INTERNAL_SECRET }, await database('catalog'));
      await catalog.prepare();
      const catalogServer = await listen(catalog.app, 0, '127.0.0.1');
      closers.push(catalogServer.close);
      targets.catalog = catalogServer.url;

      if (options.events) await catalog.consume(bus);

      const inventoryDb = await database('inventory');
      const inventoryConfig = readInventoryConfig({ BOOKING_SYNC_ENABLED: options.events ? 'true' : 'false' });
      const inventory = createInventoryService({ ...inventoryConfig, slotDays: 10, internalTokenSecret: INTERNAL_SECRET }, inventoryDb);
      await inventory.prepare();
      grpcServers.inventory = await startGrpcServer(
        [
          { definition: inventory.definition, implementation: inventory.implementation },
          { definition: inventory.stockService.definition, implementation: inventory.stockService.implementation },
        ],
        0,
        '127.0.0.1',
      );
      targets.inventory = `127.0.0.1:${grpcServers.inventory.port}`;
      if (options.events) {
        relays.push(new OutboxRelay(dataSources.catalog!, bus, 'catalog'), new OutboxRelay(inventoryDb, bus, 'inventory', { schema: INVENTORY_SCHEMA }));
        bookingMock = await startBookingMock(0);
        closers.push(() => bookingMock!.close());
        stockSync = new BookingStockSync(inventoryDb, { ...inventoryConfig.bookingSync, address: `127.0.0.1:${bookingMock.grpcPort}` });
        closers.push(async () => stockSync?.stop());
      }
    }
    if (options.events) {
      const audit = createAuditService({ ...readAuditConfig({}), internalTokenSecret: INTERNAL_SECRET }, await database('audit'));
      await audit.consume(bus);
      const auditServer = await listen(audit.app, 0, '127.0.0.1');
      closers.push(auditServer.close);
      targets.audit = auditServer.url;

      sriMock = await startSriMock(0);
      closers.push(() => sriMock!.close());
      targets.sri_recepcion = sriMock.recepcionUrl;
      targets.sri_autorizacion = sriMock.autorizacionUrl;
      const invoicingDb = await database('invoicing');
      invoicing = createInvoicingService({ ...readInvoicingConfig({}), esbUrl: esbServer.url, internalTokenSecret: INTERNAL_SECRET }, invoicingDb);
      await invoicing.consume(bus);
      relays.push(new OutboxRelay(invoicingDb, bus, 'invoicing'));
      const invoicingServer = await listen(invoicing.app, 0, '127.0.0.1');
      closers.push(invoicingServer.close);
      targets.invoicing = invoicingServer.url;
    }
    if (withSagas) {
      const payment = createPaymentService({ ...readPaymentConfig({}), internalTokenSecret: INTERNAL_SECRET }, await database('payment'));
      const paymentServer = await listen(payment.app, 0, '127.0.0.1');
      closers.push(paymentServer.close);
      targets.payment = paymentServer.url;

      const bookingDb = await database('booking');
      bookingFactory = async () => {
        const booking = createBookingService({ ...readBookingConfig({}), internalTokenSecret: INTERNAL_SECRET, voucherSecret: INTERNAL_SECRET }, bookingDb);
        grpcServers.booking = await startGrpcServer([{ definition: booking.definition, implementation: booking.implementation }], 0, '127.0.0.1');
        targets.booking = `127.0.0.1:${grpcServers.booking.port}`;
      };
      await bookingFactory();

      order = createOrderService({ ...readOrderConfig({}), esbUrl: esbServer.url, internalTokenSecret: INTERNAL_SECRET, stuckSagaSeconds: 0 }, await database('order'));
      grpcServers.order = await startGrpcServer([{ definition: order.definition, implementation: order.implementation }], 0, '127.0.0.1');
      targets.order = `127.0.0.1:${grpcServers.order.port}`;
      if (options.events) {
        relays.push(
          new OutboxRelay(dataSources.order!, bus, 'order'),
          new OutboxRelay(dataSources.booking!, bus, 'booking'),
          new OutboxRelay(dataSources.payment!, bus, 'payment'),
        );
      }
    }
    closers.push(async () => {
      for (const server of Object.values(grpcServers)) await server?.close();
    });

    let graphqlUrl: string | null = null;
    if (options.portal) {
      const cart = createCartService({ ...readCartConfig({}), internalTokenSecret: INTERNAL_SECRET }, await database('cart'));
      const cartServer = await listen(cart.app, 0, '127.0.0.1');
      closers.push(cartServer.close);
      targets.cart = cartServer.url;

      graphql = await createGraphqlServer({ ...readGraphqlConfig({ INTERNAL_TOKEN_SECRET: INTERNAL_SECRET }), esbUrl: esbServer.url });
      await graphql.invalidateOn(bus);
      const graphqlServer = await listen(graphql.app, 0, '127.0.0.1');
      closers.push(async () => {
        await graphql!.close();
        await graphqlServer.close();
      });
      graphqlUrl = graphqlServer.url;
    }

    const partner = createPartnerApi({
      ...readPartnerApiConfig({ INTERNAL_TOKEN_SECRET: INTERNAL_SECRET, VALIDATE_RESPONSES: 'true' }),
      esbUrl: esbServer.url,
      health: { critical: options.healthCritical ?? [], optional: [], cacheMs: 0, timeoutMs: 1000 },
    });
    if (options.events) await partner.invalidateOn(bus);
    const partnerServer: RunningServer = await listen(partner.app, 0, '127.0.0.1');
    closers.push(async () => {
      await partner.cache.close();
      await partnerServer.close();
    });

    const gatewayConfig = readGatewayConfig({ INTERNAL_TOKEN_SECRET: INTERNAL_SECRET, IDENTITY_URL: identityServer.url });
    const gateway: INestApplication = await createGateway({
      ...gatewayConfig,
      upstreams: { ...gatewayConfig.upstreams, partnerApi: partnerServer.url, esb: esbServer.url, monolith: null, graphql: graphqlUrl },
      rateLimitPerMinute: options.rateLimitPerMinute ?? 1000,
    });
    await gateway.listen(0, '127.0.0.1');
    closers.push(() => gateway.close());
    const port = (gateway.getHttpServer().address() as AddressInfo).port;

    return {
      gatewayUrl: `http://127.0.0.1:${port}`,
      identity,
      esb,
      order,
      databases: dataSources,
      bus,
      bookingMock,
      sriMock,
      graphql,
      inventoryGrpcPort: grpcServers.inventory?.port,
      pumpEvents: async () => {
        // Varias vueltas: un evento consumido puede producir otros (p. ej. OrdenConfirmada → factura → FacturaAutorizada).
        for (let i = 0; i < 3; i++) {
          for (const relay of relays) while ((await relay.publishPending()) > 0);
          await bus.drain();
          // Recepción y luego autorización en el SRI.
          if (invoicing) for (let j = 0; j < 2; j++) await invoicing.invoicing.processQueue();
        }
        await stockSync?.sendPending();
      },
      stop: async (service) => {
        await grpcServers[service]?.close();
        grpcServers[service] = null;
      },
      restart: async () => {
        await bookingFactory?.();
      },
      close: async () => {
        for (const close of closers.reverse()) await close();
        for (const db of databases) await db.drop();
      },
    };
  } catch (error) {
    for (const close of closers.reverse()) await close().catch(() => undefined);
    for (const db of databases) await db.drop().catch(() => undefined);
    throw error;
  }
}

/** Crea un usuario con los roles indicados y devuelve su access token (JWT RS256 de Identity). */
export async function userToken(system: System, email: string, roles: string[]): Promise<string> {
  const db = system.databases.identity!;
  const { id } = await system.identity.accounts.register({ email, password: 'clave-de-pruebas-1', nombre_completo: 'Usuario de Pruebas' });
  for (const rol of roles) {
    await db.query(`INSERT INTO usuario_rol (usuario_id, rol_id, motivo) SELECT $1, id, 'pruebas' FROM rol WHERE nombre = $2 ON CONFLICT DO NOTHING`, [id, rol]);
  }
  return (await system.identity.accounts.login({ email, password: 'clave-de-pruebas-1' })).access_token;
}
