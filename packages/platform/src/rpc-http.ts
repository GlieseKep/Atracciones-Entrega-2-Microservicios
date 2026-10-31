import type { Express } from 'express';
import { fromServiceError, grpc } from './grpc';
import { checkHealth } from './health';
import { createHttpService, requireServiceToken } from './http';
import type { Logger } from './logging';
import type { DataSource } from 'typeorm';

export interface RpcHttpOptions {
  service: string;
  definition: grpc.ServiceDefinition;
  implementation: grpc.UntypedServiceImplementation;
  /** Secreto de `X-Service-Token`: estas rutas quedan en internet en App Service. */
  serviceToken: string;
  dataSource: DataSource;
  logger: Logger;
}

const toMetadata = (headers: Record<string, string | string[] | undefined>): grpc.Metadata => {
  const metadata = new grpc.Metadata();
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string' && !name.endsWith('-bin')) metadata.set(name, value);
  }
  return metadata;
};

/**
 * Expone cada RPC de un servicio en `POST /internal/rpc/<Método>` con JSON, para desplegarlo en App Service. El `.proto`
 * sigue siendo el contrato: entrada y salida pasan por protobuf, con los mismos tipos y valores por defecto que por gRPC.
 */
export function createRpcHttpService(options: RpcHttpOptions): Express {
  const { service, definition, implementation, serviceToken, dataSource, logger } = options;
  return createHttpService({
    service,
    logger,
    health: () => checkHealth(service, dataSource),
    routes: (app) => {
      app.use('/internal/rpc', requireServiceToken(serviceToken));
      for (const [name, method] of Object.entries(definition)) {
        const handler = implementation[name] as grpc.handleUnaryCall<unknown, unknown>;
        app.post(`/internal/rpc/${name}`, (req, res, next) => {
          const request = method.requestDeserialize(method.requestSerialize(req.body ?? {}));
          const call = { request, metadata: toMetadata(req.headers) } as grpc.ServerUnaryCall<unknown, unknown>;
          handler(call, (error, response) => {
            if (error) return next(fromServiceError(error as grpc.ServiceError));
            try {
              res.json(method.responseDeserialize(method.responseSerialize(response)));
            } catch (failure) {
              next(failure);
            }
          });
        });
      }
    },
  });
}
