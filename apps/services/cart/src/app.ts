import {
  AppError,
  checkHealth,
  createHttpService,
  normalizeTime,
  requirePrincipal,
  TIPOS_BOLETO,
  type DatabaseSettings,
  type InvalidParam,
} from '@atracciones/platform';
import type { Express } from 'express';
import type { DataSource } from 'typeorm';
import { CartRepository, type CartTicket } from './persistence/cart-repository';

export interface CartConfig {
  port: number;
  database: DatabaseSettings;
  internalTokenSecret: string;
  /** Turnos distintos que puede tener un carrito. */
  maxItems: number;
}

export function readCartConfig(env: NodeJS.ProcessEnv = process.env): CartConfig {
  return {
    port: Number(env.PORT ?? 4004),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/cart_db', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    maxItems: Number(env.CART_MAX_ITEMS ?? 10),
  };
}

const CODIGO = /^[A-Za-z0-9]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mismo tope de boletos por turno que una reserva del portal. */
const MAX_TICKETS = 20;

/**
 * Boletos de un ítem: al menos un adulto (como `adult_count` del contrato, minimum 1), cantidades enteras positivas y
 * un tipo por fila. Los tipos con cantidad 0 se descartan.
 */
export function parseTickets(value: unknown): CartTicket[] {
  const invalid: InvalidParam[] = [];
  const list = Array.isArray(value) ? value : [];
  const byType = new Map<string, number>();
  for (const [i, raw] of list.entries()) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const tipo = String(t.ticket_type ?? '');
    const cantidad = Number(t.cantidad);
    if (!TIPOS_BOLETO.includes(tipo as (typeof TIPOS_BOLETO)[number])) invalid.push({ name: `boletos[${i}].ticket_type`, reason: `Debe ser uno de ${TIPOS_BOLETO.join(', ')}.` });
    else if (!Number.isInteger(cantidad) || cantidad < 0) invalid.push({ name: `boletos[${i}].cantidad`, reason: 'Debe ser un entero mayor o igual a cero.' });
    else if (cantidad > 0) byType.set(tipo, (byType.get(tipo) ?? 0) + cantidad);
  }
  const boletos = [...byType].map(([ticket_type, cantidad]) => ({ ticket_type, cantidad }));
  if (!invalid.length && !byType.get('ADULT')) invalid.push({ name: 'boletos', reason: 'Debe incluir al menos un boleto ADULT.' });
  if (!invalid.length && boletos.reduce((s, b) => s + b.cantidad, 0) > MAX_TICKETS) invalid.push({ name: 'boletos', reason: `Máximo ${MAX_TICKETS} boletos por turno.` });
  if (invalid.length) throw AppError.validation('Los boletos del carrito no son válidos.', invalid);
  return boletos;
}

export interface CartService {
  app: Express;
  repository: CartRepository;
}

/** Cart & Wishlist Service (REST, plan §3.4). Solo lo usa el portal, a través de GraphQL. */
export function createCartService(config: CartConfig, dataSource: DataSource): CartService {
  const repository = new CartRepository(dataSource);
  /** El carrito y los favoritos son de usuarios del portal (no de socios con X-API-Key). */
  const user = async () => {
    const principal = await requirePrincipal(config.internalTokenSecret);
    if (principal.tipo !== 'USUARIO') throw AppError.forbidden('El carrito es solo para usuarios del portal.');
    return principal.id;
  };
  const ids = (value: unknown) => (Array.isArray(value) ? value.map(String).filter((id) => UUID.test(id)) : []);

  const app = createHttpService({
    service: 'cart',
    health: () => checkHealth('cart', dataSource),
    routes: (a) => {
      a.get('/carrito', async (_req, res) => {
        res.json(await repository.get(await user()));
      });
      a.post('/carrito/items', async (req, res) => {
        const usuario = await user();
        const body = (req.body ?? {}) as Record<string, unknown>;
        const codigo = String(body.atraccion_codigo ?? '');
        const fecha = String(body.fecha ?? '');
        const hora = normalizeTime(String(body.hora ?? ''));
        const invalid: InvalidParam[] = [];
        if (!CODIGO.test(codigo)) invalid.push({ name: 'atraccion_codigo', reason: 'Código público de 12 caracteres.' });
        if (!DATE.test(fecha)) invalid.push({ name: 'fecha', reason: 'Formato YYYY-MM-DD.' });
        if (!hora) invalid.push({ name: 'hora', reason: 'Formato HH:mm o HH:mm:ss.' });
        if (invalid.length) throw AppError.validation('El ítem del carrito no es válido.', invalid);
        const result = await repository.upsertItem(usuario, { atraccion_codigo: codigo, fecha, hora: hora!, boletos: parseTickets(body.boletos) }, config.maxItems);
        if (result === 'FULL') throw AppError.conflict('CART_FULL', `El carrito admite como máximo ${config.maxItems} turnos distintos.`);
        res.status(201).json(await repository.get(usuario));
      });
      a.put('/carrito/items/:id', async (req, res) => {
        const usuario = await user();
        if (!UUID.test(req.params.id) || !(await repository.updateItem(usuario, req.params.id, parseTickets(req.body?.boletos)))) {
          throw AppError.notFound('El ítem no está en tu carrito.', 'CART_ITEM_NOT_FOUND');
        }
        res.json(await repository.get(usuario));
      });
      a.delete('/carrito/items/:id', async (req, res) => {
        const usuario = await user();
        await repository.removeItems(usuario, ids([req.params.id]));
        res.json(await repository.get(usuario));
      });
      // Tras comprar desde el carrito, GraphQL quita los ítems comprados.
      a.post('/carrito/comprados', async (req, res) => {
        const usuario = await user();
        await repository.markPurchased(usuario, ids(req.body?.item_ids));
        res.json(await repository.get(usuario));
      });
      a.delete('/carrito', async (_req, res) => {
        const usuario = await user();
        await repository.clear(usuario);
        res.json(await repository.get(usuario));
      });

      a.get('/favoritos', async (_req, res) => {
        res.json(await repository.favorites(await user()));
      });
      a.put('/favoritos/:codigo', async (req, res) => {
        const usuario = await user();
        if (!CODIGO.test(req.params.codigo)) throw AppError.validation('Código de atracción inválido.', [{ name: 'codigo', reason: 'Código público de 12 caracteres.' }]);
        await repository.addFavorite(usuario, req.params.codigo);
        res.json(await repository.favorites(usuario));
      });
      a.delete('/favoritos/:codigo', async (req, res) => {
        const usuario = await user();
        await repository.removeFavorite(usuario, req.params.codigo);
        res.json(await repository.favorites(usuario));
      });
    },
  });
  return { app, repository };
}
