"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeHttpServer = void 0;
const node_http_1 = require("node:http");
/**
 * Doble HTTP para integración (plan §2.1): servidor `node:http` en un puerto libre que responde con valores fijos
 * (stub) y guarda cada petición recibida (spy). El código del sistema usa `fetch`, así que basta con apuntar la URL
 * del servicio a `url`. Una ruta sin respuesta registrada contesta 404 con ProblemDetails.
 */
class FakeHttpServer {
    constructor() {
        this.requests = [];
        this.routes = new Map();
        this.server = null;
        this.url = '';
    }
    /** `on('POST', '/internal/rpc/Quote', () => ({ body: {...} }))`. La ruta no incluye la query. */
    on(method, path, route) {
        this.routes.set(`${method.toUpperCase()} ${path}`, typeof route === 'function' ? route : () => route);
        return this;
    }
    /** Peticiones recibidas a una ruta (sin query). */
    calls(method, path) {
        return this.requests.filter((r) => r.method === method.toUpperCase() && r.path.split('?')[0] === path);
    }
    async start() {
        this.server = (0, node_http_1.createServer)((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', async () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let body = raw;
                try {
                    body = raw ? JSON.parse(raw) : undefined;
                }
                catch {
                    // cuerpo no JSON: se guarda como texto
                }
                const request = { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body };
                this.requests.push(request);
                const route = this.routes.get(`${request.method} ${request.path.split('?')[0]}`);
                const reply = route
                    ? await route(request)
                    : { status: 404, body: { status: 404, code: 'NOT_FOUND', title: 'Ruta no registrada en el doble HTTP' }, headers: { 'content-type': 'application/problem+json' } };
                const status = reply.status ?? 200;
                const headers = { 'content-type': 'application/json', ...(reply.headers ?? {}) };
                res.writeHead(status, headers);
                res.end(reply.body === undefined ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
            });
        });
        await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
        this.url = `http://127.0.0.1:${this.server.address().port}`;
        return this;
    }
    async stop() {
        if (!this.server)
            return;
        await new Promise((resolve) => this.server.close(() => resolve()));
        this.server = null;
    }
}
exports.FakeHttpServer = FakeHttpServer;
//# sourceMappingURL=fake-http.js.map