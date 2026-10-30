import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { CART_BASE_PATH, MS_CART_ROUTES } from './esb-routes';

const CONTRACT = join(__dirname, '..', '..', '..', '..', '..', 'Plan', 'ms_cart', 'ms_cart-openapi.yaml');
const contract = load(readFileSync(CONTRACT, 'utf8')) as { servers: { url: string }[]; paths: Record<string, Record<string, unknown>> };

/** `/api/v3/carritos/:cart_id/items` → `/carritos/{cart_id}/items` (forma del contrato). */
const toContractPath = (path: string) => path.slice(CART_BASE_PATH.length).replace(/:([A-Za-z_]+)/g, '{$1}');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

describe('rutas del ESB hacia Cart', () => {
  it('usan el prefijo del contrato', () => {
    expect(contract.servers[0].url).toBe(CART_BASE_PATH);
  });

  it.each(Object.entries(MS_CART_ROUTES))('%s existe en el contrato con el mismo método', (_key, route) => {
    const operations = contract.paths[toContractPath(route.path)];
    expect(operations).toBeDefined();
    expect(operations[route.method.toLowerCase()]).toBeDefined();
  });

  it('cubren todas las operaciones del contrato', () => {
    const declared = Object.entries(contract.paths).flatMap(([path, ops]) => METHODS.filter((m) => m in ops).map((m) => `${m.toUpperCase()} ${path}`));
    const routed = Object.values(MS_CART_ROUTES).map((r) => `${r.method} ${toContractPath(r.path)}`);
    expect(routed.sort()).toEqual(declared.sort());
  });

  it('los parámetros solo tienen letras y _ (los que el ESB sabe sustituir)', () => {
    for (const route of Object.values(MS_CART_ROUTES)) {
      for (const [, name] of route.path.matchAll(/:([^/]+)/g)) expect(name).toMatch(/^[A-Za-z_]+$/);
    }
  });
});
