import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { openApiContractPath } from '@atracciones/platform';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface OpenApiDocument {
  paths: Record<string, Partial<Record<(typeof METHODS)[number], { responses?: Record<string, unknown> }>>>;
}

/** Códigos HTTP documentados en el contrato para cada operación (`GET /atracciones/{id}` → {200, 404, 500}). */
export class ContractStatuses {
  private readonly allowed = new Map<string, Set<number>>();

  constructor(document: OpenApiDocument) {
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of METHODS) {
        const operation = item[method];
        if (!operation) continue;
        const codes = Object.keys(operation.responses ?? {}).map(Number).filter((n) => Number.isInteger(n));
        this.allowed.set(`${method.toUpperCase()} ${path}`, new Set(codes));
      }
    }
  }

  static load(): ContractStatuses {
    return new ContractStatuses(load(readFileSync(openApiContractPath(), 'utf8')) as OpenApiDocument);
  }

  /** Operaciones del contrato (`MÉTODO /ruta`). */
  operations(): string[] {
    return [...this.allowed.keys()];
  }

  /** Acepta la ruta con o sin el prefijo del servidor (`/api/v2/atracciones/{id}` o `/atracciones/{id}`). */
  allowedFor(method: string, openApiPath: string): Set<number> | undefined {
    return this.allowed.get(`${method.toUpperCase()} ${openApiPath.replace(/^\/api\/v\d+/, '')}`);
  }

  /**
   * Plan §7.2.1: la Partner API solo devuelve códigos documentados en la operación. Un código no documentado se cambia
   * por el más cercano permitido: un 4xx por 400 y un 5xx por 500 (o 503 si solo ese existe, como en `/health`).
   */
  normalize(method: string, openApiPath: string, status: number): number {
    const allowed = this.allowedFor(method, openApiPath);
    if (!allowed || allowed.has(status)) return status;
    if (status < 500 && allowed.has(400)) return 400;
    if (allowed.has(500)) return 500;
    if (allowed.has(503)) return 503;
    return status;
  }
}
