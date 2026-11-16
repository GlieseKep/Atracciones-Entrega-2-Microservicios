import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Petición recibida por el servidor falso (para usarlo como spy). */
export interface ReceivedRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type FakeRoute = (request: ReceivedRequest) => FakeReply | Promise<FakeReply>;

/**
 * Doble HTTP para integración (plan §2.1): servidor `node:http` en un puerto libre que responde con valores fijos
 * (stub) y guarda cada petición recibida (spy). El código del sistema usa `fetch`, así que basta con apuntar la URL
 * del servicio a `url`. Una ruta sin respuesta registrada contesta 404 con ProblemDetails.
 */
export class FakeHttpServer {
  readonly requests: ReceivedRequest[] = [];
  private readonly routes = new Map<string, FakeRoute>();
  private server: Server | null = null;
  url = '';

  /** `on('POST', '/internal/rpc/Quote', () => ({ body: {...} }))`. La ruta no incluye la query. */
  on(method: string, path: string, route: FakeRoute | FakeReply): this {
    this.routes.set(`${method.toUpperCase()} ${path}`, typeof route === 'function' ? route : () => route);
    return this;
  }

  /** Peticiones recibidas a una ruta (sin query). */
  calls(method: string, path: string): ReceivedRequest[] {
    return this.requests.filter((r) => r.method === method.toUpperCase() && r.path.split('?')[0] === path);
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', async () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: unknown = raw;
        try {
          body = raw ? JSON.parse(raw) : undefined;
        } catch {
          // cuerpo no JSON: se guarda como texto
        }
        const request: ReceivedRequest = { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body };
        this.requests.push(request);
        const route = this.routes.get(`${request.method} ${request.path.split('?')[0]}`);
        const reply: FakeReply = route
          ? await route(request)
          : { status: 404, body: { status: 404, code: 'NOT_FOUND', title: 'Ruta no registrada en el doble HTTP' }, headers: { 'content-type': 'application/problem+json' } };
        const status = reply.status ?? 200;
        const headers = { 'content-type': 'application/json', ...(reply.headers ?? {}) };
        res.writeHead(status, headers);
        res.end(reply.body === undefined ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}
