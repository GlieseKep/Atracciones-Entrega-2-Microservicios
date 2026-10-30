import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { contextFromHeaders, currentContext, propagationHeaders, runWithContext } from './correlation';
import { protoPath } from './contract-files';
import { errorFields, type Logger } from './logging';
import { AppError, fromProblem, toProblem } from './problem-details';

/** Metadata binaria con el ProblemDetails completo del error (estado HTTP, código, detalle, invalid_params). */
const PROBLEM_METADATA = 'x-problem-bin';

/**
 * Carga un proto de `packages/contracts/proto`. `keepCase` conserva los nombres snake_case del contrato
 * (`available_units`, `time_slot`) y los int64 se reciben como `number`.
 */
export function loadProto(relativePath: string): grpc.GrpcObject {
  const definition = protoLoader.loadSync(protoPath(relativePath), {
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
    // Los protos internos se importan entre sí (`import "internal/booking.proto"`).
    includeDirs: [protoPath('')],
  });
  return grpc.loadPackageDefinition(definition);
}

/** Obtiene un servicio por su nombre completo, p. ej. `inventory.InventoryStockService`. */
export function serviceConstructor(proto: grpc.GrpcObject, fullName: string): grpc.ServiceClientConstructor {
  const found = fullName.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], proto);
  if (typeof found !== 'function') throw new Error(`El proto no define el servicio ${fullName}.`);
  return found as grpc.ServiceClientConstructor;
}

const HTTP_TO_GRPC: Record<number, grpc.status> = {
  400: grpc.status.INVALID_ARGUMENT,
  401: grpc.status.UNAUTHENTICATED,
  403: grpc.status.PERMISSION_DENIED,
  404: grpc.status.NOT_FOUND,
  409: grpc.status.ABORTED,
  422: grpc.status.FAILED_PRECONDITION,
  503: grpc.status.UNAVAILABLE,
};

/** Estado gRPC equivalente a un error (con el ProblemDetails en la metadata). También sirve para cerrar streams. */
export function toServiceError(error: unknown, logger: Logger, method: string): Partial<grpc.ServiceError> {
  const problem = toProblem(error);
  if (problem.status >= 500 && !(error instanceof AppError)) logger.error('error no controlado en gRPC', { method, ...errorFields(error) });
  const metadata = new grpc.Metadata();
  metadata.set(PROBLEM_METADATA, Buffer.from(JSON.stringify(problem), 'utf8'));
  const code = problem.code === 'OUT_OF_STOCK' ? grpc.status.RESOURCE_EXHAUSTED : HTTP_TO_GRPC[problem.status] ?? grpc.status.INTERNAL;
  return { code, details: problem.detail, metadata };
}

const metadataReader = (metadata: grpc.Metadata) => (name: string) => metadata.get(name)[0]?.toString();

export type UnaryHandler<Req, Res> = (request: Req) => Promise<Res>;

/**
 * Adapta una función async a un handler unario de gRPC: crea el contexto de la petición desde la metadata
 * (correlación, principal, idempotencia) y convierte cualquier error en un estado gRPC con el ProblemDetails adjunto.
 */
export function unary<Req, Res>(method: string, handler: UnaryHandler<Req, Res>, logger: Logger): grpc.handleUnaryCall<Req, Res> {
  return (call, callback) => {
    const context = contextFromHeaders(metadataReader(call.metadata));
    runWithContext(context, () => {
      const begin = performance.now();
      handler(call.request)
        .then((response) => {
          logger.info('grpc', { method, status: 'OK', duration_ms: Math.round(performance.now() - begin) });
          callback(null, response);
        })
        .catch((error: unknown) => {
          logger.info('grpc', { method, status: 'ERROR', code: error instanceof AppError ? error.code : 'INTERNAL_ERROR', duration_ms: Math.round(performance.now() - begin) });
          callback(toServiceError(error, logger, method));
        });
    });
  };
}

/** Handler para un RPC con streaming del cliente (p. ej. `StreamInventoryChanges`). */
export function clientStream<Req, Res>(method: string, handler: (messages: AsyncIterable<Req>) => Promise<Res>, logger: Logger): grpc.handleClientStreamingCall<Req, Res> {
  return (call, callback) => {
    const context = contextFromHeaders(metadataReader(call.metadata));
    runWithContext(context, () => {
      handler(call as unknown as AsyncIterable<Req>)
        .then((response) => callback(null, response))
        .catch((error: unknown) => callback(toServiceError(error, logger, method)));
    });
  };
}

export interface GrpcServerHandle {
  port: number;
  close(): Promise<void>;
}

/** Inicia un servidor gRPC sin TLS (red interna) con los servicios indicados. Puerto 0 = libre. */
export async function startGrpcServer(
  services: { definition: grpc.ServiceDefinition; implementation: grpc.UntypedServiceImplementation }[],
  port: number,
  host = '0.0.0.0',
): Promise<GrpcServerHandle> {
  const server = new grpc.Server();
  for (const s of services) server.addService(s.definition, s.implementation);
  const actual = await new Promise<number>((resolve, reject) =>
    server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (error, bound) => (error ? reject(error) : resolve(bound))),
  );
  return {
    port: actual,
    close: () => new Promise<void>((resolve) => server.tryShutdown(() => resolve())),
  };
}

/** Metadata de salida con el contexto actual (y una clave de idempotencia propia del paso, si se indica). */
export function outgoingMetadata(extra: Record<string, string> = {}): grpc.Metadata {
  const metadata = new grpc.Metadata();
  for (const [name, value] of Object.entries({ ...propagationHeaders(currentContext()), ...extra })) metadata.set(name, value);
  return metadata;
}

/** Convierte un error de gRPC recibido en `AppError` (con el ProblemDetails original si lo trae). */
export function fromServiceError(error: grpc.ServiceError): AppError {
  const problem = error.metadata?.get(PROBLEM_METADATA)[0];
  if (problem) {
    try {
      return fromProblem(JSON.parse(Buffer.isBuffer(problem) ? problem.toString('utf8') : String(problem)), 500);
    } catch {
      /* metadata corrupta: se usa el estado gRPC */
    }
  }
  if (error.code === grpc.status.UNAVAILABLE || error.code === grpc.status.DEADLINE_EXCEEDED) return AppError.unavailable();
  if (error.code === grpc.status.RESOURCE_EXHAUSTED) return AppError.conflict('OUT_OF_STOCK', error.details);
  return AppError.internal();
}

/** Llamada unaria con plazo, propagación de contexto y errores como `AppError`. */
export function callUnary<Req, Res>(
  client: grpc.Client,
  method: string,
  request: Req,
  options: { deadlineMs?: number; metadata?: Record<string, string> } = {},
): Promise<Res> {
  const fn = (client as unknown as Record<string, Function>)[method];
  if (typeof fn !== 'function') return Promise.reject(new Error(`El cliente gRPC no tiene el método ${method}.`));
  return new Promise<Res>((resolve, reject) => {
    fn.call(
      client,
      request,
      outgoingMetadata(options.metadata),
      { deadline: new Date(Date.now() + (options.deadlineMs ?? 2000)) },
      (error: grpc.ServiceError | null, response: Res) => (error ? reject(fromServiceError(error)) : resolve(response)),
    );
  });
}

export function insecureClient(constructor: grpc.ServiceClientConstructor, address: string): grpc.Client {
  return new constructor(address, grpc.credentials.createInsecure());
}

export { grpc };
