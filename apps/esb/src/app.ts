import CircuitBreaker from 'opossum';
import {
  AppError,
  callUnary,
  createHttpService,
  createLogger,
  httpJson,
  insecureClient,
  loadProto,
  serviceConstructor,
  type grpc,
  type Logger,
} from '@atracciones/platform';
import type { Express } from 'express';
import { ROUTES, type GrpcRoute, type RestRoute, type Route, type SoapRoute, type TargetName } from './routes';
import { parseSoapResponse, soapEnvelope } from './soap';

export interface EsbConfig {
  port: number;
  /** URL base (REST) o `host:puerto` (gRPC) de cada servicio. */
  targets: Partial<Record<TargetName, string>>;
  breaker: { errorThresholdPercentage: number; resetTimeoutMs: number; volumeThreshold: number };
  /** Envía el `correlation_id` en el SOAP Header (desactivable si el servicio externo lo rechaza). */
  soapCorrelationHeader?: boolean;
}

export function readEsbConfig(env: NodeJS.ProcessEnv = process.env): EsbConfig {
  return {
    port: Number(env.PORT ?? 3300),
    targets: {
      identity: env.IDENTITY_URL ?? 'http://127.0.0.1:4001',
      catalog: env.CATALOG_URL ?? 'http://127.0.0.1:4002',
      inventory: env.INVENTORY_GRPC ?? '127.0.0.1:50061',
      cart: env.CART_URL ?? 'http://127.0.0.1:4004',
      order: env.ORDER_GRPC ?? '127.0.0.1:50065',
      booking: env.BOOKING_GRPC ?? '127.0.0.1:50066',
      payment: env.PAYMENT_URL ?? 'http://127.0.0.1:4007',
      invoicing: env.INVOICING_URL ?? 'http://127.0.0.1:4008',
      audit: env.AUDIT_URL ?? 'http://127.0.0.1:4009',
      // Ambiente de pruebas del SRI: https://celcer.sri.gob.ec/comprobantes-electronicos-ws/...; en local, el mock (apps/sri-mock).
      sri_recepcion: env.SRI_RECEPCION_URL ?? 'http://127.0.0.1:4091/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
      sri_autorizacion: env.SRI_AUTORIZACION_URL ?? 'http://127.0.0.1:4091/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
    },
    soapCorrelationHeader: (env.SOAP_CORRELATION_HEADER ?? 'true') === 'true',
    breaker: {
      errorThresholdPercentage: Number(env.BREAKER_ERROR_PERCENT ?? 50),
      resetTimeoutMs: Number(env.BREAKER_RESET_MS ?? 10_000),
      volumeThreshold: Number(env.BREAKER_VOLUME ?? 5),
    },
  };
}

type Input = Record<string, unknown>;

/** Sustituye los `:parametros` de la ruta con la entrada y devuelve lo que sobra. */
function fillPath(path: string, input: Input): { path: string; rest: Input } {
  const rest = { ...input };
  const filled = path.replace(/:([A-Za-z_]+)/g, (_m, name: string) => {
    const value = rest[name];
    delete rest[name];
    if (value === undefined || value === null || value === '') throw AppError.validation(`Falta el parámetro '${name}'.`);
    return encodeURIComponent(String(value));
  });
  return { path: filled, rest };
}

function queryString(input: Input): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, String(v));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Enrutador del ESB: un invocador por ruta, cada uno con su circuit breaker. */
export class EsbRouter {
  private readonly breakers = new Map<string, CircuitBreaker<[Input], unknown>>();
  private readonly grpcClients = new Map<string, grpc.Client>();

  constructor(
    private readonly config: EsbConfig,
    private readonly logger: Logger,
  ) {}

  async invoke(key: string, input: Input): Promise<unknown> {
    const route = ROUTES[key];
    if (!route) throw AppError.notFound(`El ESB no tiene la ruta '${key}'.`, 'ROUTE_NOT_FOUND');
    const breaker = this.breakerFor(key, route);
    try {
      return await breaker.fire(input);
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Circuito abierto: el servicio falló repetidamente y se deja de llamarlo por un tiempo.
      if ((error as { code?: string }).code === 'EOPENBREAKER') throw AppError.unavailable(`El servicio '${route.target}' no está disponible (circuito abierto).`);
      throw error;
    }
  }

  close(): void {
    for (const breaker of this.breakers.values()) breaker.shutdown();
    for (const client of this.grpcClients.values()) client.close();
  }

  private breakerFor(key: string, route: Route): CircuitBreaker<[Input], unknown> {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      const invoke = (input: Input) =>
        route.protocol === 'rest' ? this.rest(route, input) : route.protocol === 'grpc' ? this.grpc(route, input) : this.soap(route, input);
      breaker = new CircuitBreaker(invoke, {
        timeout: false, // cada adaptador aplica el plazo de la ruta
        errorThresholdPercentage: this.config.breaker.errorThresholdPercentage,
        resetTimeout: this.config.breaker.resetTimeoutMs,
        volumeThreshold: this.config.breaker.volumeThreshold,
        // Solo los fallos técnicos abren el circuito; un 4xx es una respuesta válida del servicio.
        errorFilter: (error: unknown) => error instanceof AppError && error.status < 500,
      });
      breaker.on('open', () => this.logger.warn('circuito abierto', { ruta: key, servicio: route.target }));
      breaker.on('close', () => this.logger.info('circuito cerrado', { ruta: key, servicio: route.target }));
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  private target(route: Route): string {
    const address = this.config.targets[route.target];
    if (!address) throw AppError.unavailable(`El servicio '${route.target}' no está configurado en el ESB.`);
    return address;
  }

  private async rest(route: RestRoute, input: Input): Promise<unknown> {
    const { path, rest } = fillPath(route.path, input);
    const withQuery = route.method === 'GET' || route.method === 'DELETE';
    const { body } = await httpJson(`${this.target(route).replace(/\/$/, '')}${path}${withQuery ? queryString(rest) : ''}`, {
      method: route.method,
      body: withQuery ? undefined : rest,
      timeoutMs: route.timeoutMs ?? 5000,
    });
    return body ?? null;
  }

  /** Adaptador SOAP 1.1: JSON → sobre SOAP (con el correlation_id en el Header) → respuesta XML → JSON. */
  private async soap(route: SoapRoute, input: Input): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.target(route), {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '""' },
        body: soapEnvelope(route.namespace, route.operation, input, route.correlationHeader ?? this.config.soapCorrelationHeader ?? true),
        signal: AbortSignal.timeout(route.timeoutMs ?? 15_000),
      });
    } catch {
      throw AppError.unavailable(`El servicio SOAP '${route.target}' no responde.`);
    }
    const xml = await response.text();
    if (!response.ok && !xml.includes('Fault')) throw AppError.unavailable(`El servicio SOAP '${route.target}' respondió HTTP ${response.status}.`);
    return parseSoapResponse(xml, route.operation);
  }

  private async grpc(route: GrpcRoute, input: Input): Promise<unknown> {
    const address = this.target(route);
    const clientKey = `${route.service}@${address}`;
    let client = this.grpcClients.get(clientKey);
    if (!client) {
      client = insecureClient(serviceConstructor(loadProto(route.proto), route.service), address);
      this.grpcClients.set(clientKey, client);
    }
    return callUnary(client, route.method, input, { deadlineMs: route.timeoutMs ?? 2000 });
  }
}

export interface Esb {
  app: Express;
  router: EsbRouter;
}

/** ESB (plan §3.10): `POST /esb/{servicio}/{operación}` con la entrada en JSON. */
export function createEsb(config: EsbConfig): Esb {
  const logger = createLogger('esb');
  const router = new EsbRouter(config, logger);
  const app = createHttpService({
    service: 'esb',
    logger,
    bodyLimit: '512kb',
    health: async () => ({
      status: 'UP',
      service: 'esb',
      database_connected: null,
      latency_ms: 0,
      memory_usage_mb: Math.round(process.memoryUsage().rss / 1048576),
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    }),
    routes: (a) => {
      a.get('/esb/routes', (_req, res) => {
        res.json(Object.entries(ROUTES).map(([key, r]) => ({ ruta: key, protocolo: r.protocol, servicio: r.target })));
      });
      a.post('/esb/:service/:operation', async (req, res) => {
        const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Input) : {};
        res.json(await router.invoke(`${req.params.service}.${req.params.operation}`, input));
      });
    },
  });
  return { app, router };
}
