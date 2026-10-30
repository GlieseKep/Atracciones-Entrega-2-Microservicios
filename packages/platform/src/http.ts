import { timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import { contextFromHeaders, currentContext, HEADERS, propagationHeaders, runWithContext } from './correlation';
import type { ServiceHealth } from './health';
import { createLogger, errorFields, type Logger } from './logging';
import { AppError, fromProblem, PROBLEM_CONTENT_TYPE, toProblem } from './problem-details';

/**
 * Contexto por petición: lee `X-Correlation-Id` (o lo genera), el principal interno y la `Idempotency-Key`, devuelve el
 * id en la respuesta y registra una línea JSON al terminar.
 */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const context = contextFromHeaders((name) => req.headers[name]);
    res.setHeader('X-Correlation-Id', context.correlationId);
    const begin = performance.now();
    res.on('finish', () =>
      runWithContext(context, () =>
        logger.info('request', { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, duration_ms: Math.round(performance.now() - begin) }),
      ),
    );
    runWithContext(context, next);
  };
}

/** Responde cualquier error como `application/problem+json`; los 5xx se registran con su stack. */
export function problemHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    let appError: unknown = error;
    // JSON mal formado o cuerpo demasiado grande (body-parser).
    if (!(error instanceof AppError) && typeof error?.status === 'number' && error.status < 500 && error.type) {
      appError = AppError.validation(error.type === 'entity.parse.failed' ? 'El cuerpo no es un JSON válido.' : String(error.message));
    }
    const problem = toProblem(appError, req.originalUrl.split('?')[0]);
    if (problem.status >= 500) {
      // Un AppError 5xx viene de otro componente (ya lo registró quien lo originó); el resto es un defecto propio.
      if (appError instanceof AppError) logger.warn('error 5xx retransmitido', { method: req.method, path: req.originalUrl, code: appError.code });
      else logger.error('error no controlado', { method: req.method, path: req.originalUrl, ...errorFields(error) });
    }
    if (res.headersSent) return;
    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
  };
}

/** Protege las rutas `/internal/**`: exige la cabecera `X-Service-Token` con el secreto de los componentes internos. */
export function requireServiceToken(secret: string): RequestHandler {
  const expected = Buffer.from(secret);
  return (req, _res, next) => {
    const received = Buffer.from(req.get('x-service-token') ?? '');
    const valid = expected.length > 0 && received.length === expected.length && timingSafeEqual(received, expected);
    next(valid ? undefined : AppError.unauthorized('Falta un X-Service-Token válido.'));
  };
}

export interface HttpServiceOptions {
  service: string;
  logger?: Logger;
  /** Registra las rutas propias del servicio. */
  routes: (app: Express) => void;
  /** Salud del servicio para `GET /health`. */
  health?: () => Promise<ServiceHealth>;
  bodyLimit?: string;
}

/** App HTTP estándar de un componente interno: JSON, contexto, `/health`, rutas, 404 y errores RFC 7807. */
export function createHttpService(options: HttpServiceOptions): Express {
  const logger = options.logger ?? createLogger(options.service);
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext(logger));
  app.use(express.json({ limit: options.bodyLimit ?? '256kb' }));
  if (options.health) {
    const health = options.health;
    app.get('/health', async (_req, res) => {
      const report = await health();
      res.status(report.status === 'UP' ? 200 : 503).json(report);
    });
  }
  options.routes(app);
  app.use((req, _res, next) => next(AppError.notFound(`No existe la ruta ${req.method} ${req.path}.`)));
  app.use(problemHandler(logger));
  return app;
}

export interface RunningServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Inicia la app en el puerto indicado (0 = puerto libre, útil en pruebas). */
export function listen(app: Express, port: number, host = '0.0.0.0'): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(port, host, (error?: Error) => {
      if (error) return reject(error);
      const actual = (server.address() as AddressInfo).port;
      resolve({
        port: actual,
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
    server.on('error', reject);
  });
}

export interface JsonResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * Llamada HTTP interna con JSON: propaga el contexto (correlación, principal, idempotencia), aplica un plazo y convierte
 * las respuestas `problem+json` en `AppError`. Un fallo de red o un plazo vencido se informan como 503.
 */
export async function httpJson<T>(
  url: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<JsonResponse<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...propagationHeaders(currentContext()),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
  } catch {
    throw AppError.unavailable();
  }
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) throw fromProblem(body, response.status);
  return { status: response.status, body: body as T, headers: response.headers };
}

export { HEADERS };
