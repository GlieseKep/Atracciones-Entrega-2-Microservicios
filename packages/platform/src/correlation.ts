import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Cabeceras que viajan de punta a punta (HTTP) y como metadata gRPC (en minúsculas). */
export const HEADERS = {
  correlationId: 'x-correlation-id',
  nodeId: 'x-node-id',
  principal: 'x-internal-principal',
  idempotencyKey: 'idempotency-key',
} as const;

/** Contexto de la petición en curso, disponible en cualquier punto del código asíncrono que la atiende. */
export interface RequestContext {
  correlationId: string;
  nodeId?: string | null;
  /** Token interno firmado por el Gateway con el principal autenticado (se reenvía tal cual). */
  principalToken?: string | null;
  idempotencyKey?: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const newCorrelationId = () => `cid-${randomUUID()}`;

/** Acepta un `X-Correlation-Id` recibido si es texto visible de 1 a 100 caracteres; si no, se genera uno nuevo. */
export function acceptCorrelationId(value: unknown): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === 'string' && /^[\x21-\x7e]{1,100}$/.test(text) ? text : null;
}

export function runWithContext<T>(context: RequestContext, work: () => T): T {
  return storage.run(context, work);
}

export const currentContext = (): RequestContext | undefined => storage.getStore();

export const currentCorrelationId = (): string | null => storage.getStore()?.correlationId ?? null;

/** Lee las cabeceras de propagación de una petición (HTTP o metadata gRPC ya convertida a objeto). */
export function contextFromHeaders(get: (name: string) => unknown): RequestContext {
  const text = (name: string) => {
    const value = get(name);
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' && first !== '' ? first : null;
  };
  return {
    correlationId: acceptCorrelationId(get(HEADERS.correlationId)) ?? newCorrelationId(),
    nodeId: text(HEADERS.nodeId),
    principalToken: text(HEADERS.principal),
    idempotencyKey: text(HEADERS.idempotencyKey),
  };
}

/** Cabeceras para propagar el contexto actual en una llamada saliente. */
export function propagationHeaders(context: RequestContext | undefined = currentContext()): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!context) return headers;
  headers[HEADERS.correlationId] = context.correlationId;
  if (context.nodeId) headers[HEADERS.nodeId] = context.nodeId;
  if (context.principalToken) headers[HEADERS.principal] = context.principalToken;
  if (context.idempotencyKey) headers[HEADERS.idempotencyKey] = context.idempotencyKey;
  return headers;
}
