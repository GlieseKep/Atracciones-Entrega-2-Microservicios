import { type IncomingMessage } from 'node:http';
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
export declare class FakeHttpServer {
    readonly requests: ReceivedRequest[];
    private readonly routes;
    private server;
    url: string;
    /** `on('POST', '/internal/rpc/Quote', () => ({ body: {...} }))`. La ruta no incluye la query. */
    on(method: string, path: string, route: FakeRoute | FakeReply): this;
    /** Peticiones recibidas a una ruta (sin query). */
    calls(method: string, path: string): ReceivedRequest[];
    start(): Promise<this>;
    stop(): Promise<void>;
}
//# sourceMappingURL=fake-http.d.ts.map