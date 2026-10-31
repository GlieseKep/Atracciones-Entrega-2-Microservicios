import 'reflect-metadata';
import { Catch, Controller, Get, HttpException, Module, type ArgumentsHost, type ExceptionFilter, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AppError,
  createLogger,
  currentContext,
  EsbClient,
  HEADERS,
  PROBLEM_CONTENT_TYPE,
  requestContext,
  signInternalPrincipal,
  toProblem,
  type Logger,
} from '@atracciones/platform';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { IncomingMessage } from 'node:http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Authenticator } from './authentication';
import type { GatewayConfig } from './config';

/** Cuentas y sesiones de ms-identity: las valida el propio Identity y tienen límite de solicitudes. */
const isAuthPath = (path: string) => /^\/api\/v3\/auth(\/|$)/.test(path);

/** Rutas del contrato con Booking (Partner API): se autentican y nunca responden 429. */
const isContractPath = (path: string) => /^\/api\/v3(\/|$)/.test(path) && !isAuthPath(path);

@Controller()
class HealthController {
  @Get('health')
  health() {
    return { status: 'UP', service: 'gateway' };
  }
}

/** Errores de Nest (p. ej. ruta inexistente) en formato ProblemDetails del contrato. */
@Catch()
class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const error = exception instanceof HttpException && exception.getStatus() === 404
      ? AppError.notFound(`No existe la ruta ${req.method} ${req.path}.`)
      : exception;
    const problem = toProblem(error, req.path);
    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
  }
}

@Module({ controllers: [HealthController] })
class GatewayModule {}

const sendProblem = (res: Response, error: unknown, instance: string) => {
  const problem = toProblem(error, instance);
  res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
};

/** Autentica las rutas del contrato y de GraphQL y adjunta el principal interno firmado. */
function authentication(config: GatewayConfig, authenticator: Authenticator): RequestHandler {
  return async (req, res, next) => {
    // Nadie de afuera puede enviar el principal interno: solo lo emite el Gateway.
    delete req.headers[HEADERS.principal];
    if (!isContractPath(req.path) && req.path !== '/graphql') return next();
    try {
      const principal = await authenticator.authenticate(req.headers);
      const context = currentContext();
      if (principal && context) context.principalToken = await signInternalPrincipal(principal, config.internalTokenSecret);
      next();
    } catch (error) {
      sendProblem(res, error, req.path);
    }
  };
}

/** Límite simple por IP y minuto, solo fuera del contrato (en él el 429 no está documentado). */
function rateLimit(perMinute: number): RequestHandler {
  const windows = new Map<string, { start: number; count: number }>();
  return (req, res, next) => {
    if (isContractPath(req.path)) return next();
    const key = req.ip ?? 'desconocida';
    const now = Date.now();
    const window = windows.get(key);
    if (!window || now - window.start >= 60_000) {
      windows.set(key, { start: now, count: 1 });
      return next();
    }
    if (++window.count > perMinute) {
      res.setHeader('Retry-After', String(Math.ceil((window.start + 60_000 - now) / 1000)));
      return sendProblem(res, new AppError(429, 'RATE_LIMITED', 'Se superó el límite de solicitudes. Reintente más tarde.', { title: 'Demasiadas solicitudes' }), req.path);
    }
    next();
  };
}

/** Proxy hacia un componente interno, con las cabeceras de contexto (correlación y principal) del Gateway. */
function proxy(target: string, filter: (path: string) => boolean, logger: Logger): RequestHandler {
  return createProxyMiddleware<Request, Response>({
    target,
    changeOrigin: true,
    pathFilter: (path: string) => filter(path),
    on: {
      proxyReq: (proxyReq, req) => {
        const context = currentContext() ?? (req as Request & { gatewayContext?: ReturnType<typeof currentContext> }).gatewayContext;
        if (!context) return;
        proxyReq.setHeader(HEADERS.correlationId, context.correlationId);
        if (context.principalToken) proxyReq.setHeader(HEADERS.principal, context.principalToken);
        else proxyReq.removeHeader(HEADERS.principal);
      },
      error: (error, req, res) => {
        logger.error('componente interno no disponible', { target, path: (req as IncomingMessage).url, error: error.message });
        const response = res as Response;
        if (typeof response.status === 'function' && !response.headersSent) {
          sendProblem(response, AppError.unavailable(), ((req as IncomingMessage).url ?? '').split('?')[0]);
        }
      },
    },
  }) as unknown as RequestHandler;
}

/** Conserva el contexto en la petición: el proxy puede ejecutar sus eventos fuera del AsyncLocalStorage. */
const keepContext: RequestHandler = (req, _res, next) => {
  (req as Request & { gatewayContext?: ReturnType<typeof currentContext> }).gatewayContext = currentContext();
  next();
};

/** Crea el Gateway (sin escuchar), reutilizable en pruebas. */
export async function createGateway(config: GatewayConfig): Promise<INestApplication> {
  const logger = createLogger('gateway');
  const app = await NestFactory.create<NestExpressApplication>(GatewayModule, { bodyParser: false, logger: ['error', 'warn'] });
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Correlation-Id', 'X-Node-Id', 'X-API-Key'],
    exposedHeaders: ['Location', 'Retry-After', 'X-Correlation-Id'],
    maxAge: 600,
  });
  const authenticator = new Authenticator(config, new EsbClient(config.upstreams.esb));

  app.use(requestContext(logger));
  app.use(keepContext);
  app.use(rateLimit(config.rateLimitPerMinute));
  app.use(authentication(config, authenticator));
  app.use(proxy(config.upstreams.identity, isAuthPath, logger));
  app.use(proxy(config.upstreams.partnerApi, isContractPath, logger));
  if (config.upstreams.graphql) app.use(proxy(config.upstreams.graphql, (p) => p === '/graphql', logger));
  app.useGlobalFilters(new ProblemFilter());
  // Si el cliente cierra la conexión, el error del proxy no debe tumbar el proceso.
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => sendProblem(res, error, req.path));
  return app;
}
