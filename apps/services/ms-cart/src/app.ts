import {
  AppError,
  BUSINESS_TIME_ZONE,
  checkHealth,
  createHttpService,
  EsbClient,
  requirePrincipal,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express, type Request } from 'express';
import type { DataSource } from 'typeorm';
import { checkCounts, parseId, parseIdempotencyKey, parseItem, parseItemPatch, parseOrderNumber, ticketTotal, type TicketCounts } from './application/cart-input';
import { assertEditable } from './application/item-purchase';
import { esbLookups, type CartLookups } from './application/lookups';
import { isPast, slotTime } from './application/slot';
import type { CartDto, CartItemDto } from './contract';
import { CART_BASE_PATH } from './integration/esb-routes';
import { CartRepository, countsOf, stateOf, type CartView, type ItemRow } from './persistence/cart-repository';

export interface MsCartConfig {
  port: number;
  database: DatabaseSettings;
  internalTokenSecret: string;
  esbUrl: string;
  /** Prefijo de las rutas del contrato (`servers[0].url`). */
  basePath: string;
  /** Ítems pendientes o en pago que puede tener un carrito. */
  maxItems: number;
  /** Días sin cambios tras los que un carrito se da por abandonado. */
  ttlDays: number;
  timeZone: string;
  /** Servicios internos que pueden usar las rutas de compra (`/carritos/**`). */
  internalCallers: string[];
}

export function readMsCartConfig(env: NodeJS.ProcessEnv = process.env): MsCartConfig {
  return {
    // 4012 mientras convive con el Cart actual (4004); en el corte toma su puerto.
    port: Number(env.PORT ?? 4012),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_cart', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    basePath: env.BASE_PATH ?? CART_BASE_PATH,
    maxItems: Number(env.CART_MAX_ITEMS ?? 10),
    ttlDays: Number(env.CART_TTL_DAYS ?? 30),
    timeZone: env.APP_TIMEZONE ?? BUSINESS_TIME_ZONE,
    internalCallers: (env.CART_INTERNAL_CALLERS ?? 'order').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);

/** `CartItem` del contrato. */
export function toItem(row: ItemRow): CartItemDto {
  const counts = countsOf(row);
  const slot = slotTime(row.dis_slot_codigo);
  return {
    item_id: Number(row.cai_id),
    attraction_id: row.atr_codigo.trim(),
    slot_id: row.dis_slot_codigo,
    date: slot?.date ?? null,
    time: slot?.time ?? null,
    adult_count: counts.adult,
    child_count: counts.child,
    senior_count: counts.senior,
    student_count: counts.student,
    infant_count: counts.infant,
    ticket_count: ticketTotal(counts),
    status: row.cai_estado,
    external_order_id: row.cai_ord_numero,
    created_at: iso(row.cai_creado_en),
  };
}

/** `Cart` del contrato; sin carrito activo responde uno vacío con `id` null. */
export function toCart(view: CartView, basePath: string): CartDto {
  const items = view.items.map(toItem);
  return {
    id: view.cart ? Number(view.cart.car_id) : null,
    active: true,
    items,
    item_count: items.length,
    ticket_count: items.reduce((sum, i) => sum + i.ticket_count, 0),
    created_at: iso(view.cart?.car_creado_en ?? null),
    updated_at: iso(view.cart?.car_actualizado_en ?? null),
    _links: { self: `${basePath}/carrito`, items: `${basePath}/carrito/items` },
  };
}

const itemNotFound = () => AppError.notFound('El ítem no está en tu carrito.', 'CART_ITEM_NOT_FOUND');
const inPayment = () => AppError.conflict('CART_ITEM_IN_PAYMENT', 'El ítem se está pagando y no se puede modificar.');

export interface MsCartDependencies {
  lookups?: CartLookups;
  logger?: Logger;
  /** Reloj para decidir si un turno ya pasó (las pruebas lo fijan). */
  now?: () => Date;
}

export interface MsCartService {
  app: Express;
  repository: CartRepository;
}

/**
 * Cart Service (REST, contrato `Plan/ms_cart/ms_cart-openapi.yaml`). El portal lo usa por GraphQL y Order por las rutas
 * internas de compra; cada atracción se paga por separado, así que cada ítem pasa a su propia orden.
 */
export function createMsCartService(config: MsCartConfig, dataSource: DataSource, deps: MsCartDependencies = {}): MsCartService {
  const repository = new CartRepository(dataSource);
  const lookups = deps.lookups ?? esbLookups(new EsbClient(config.esbUrl));
  const now = deps.now ?? (() => new Date());
  const internalNames = new Set(config.internalCallers.map((s) => `servicio-${s}`));

  /** Las rutas `/carrito/**` son de usuarios del portal (no de socios con X-API-Key ni de servicios). */
  const user = async () => {
    const principal = await requirePrincipal(config.internalTokenSecret);
    if (principal.tipo !== 'USUARIO') throw AppError.forbidden('El carrito es solo para usuarios del portal.');
    return principal.id;
  };
  /** Las rutas `/carritos/**` solo las usa Order con la cuenta de servicio que firma con el secreto interno. */
  const internalService = async () => {
    const principal = await requirePrincipal(config.internalTokenSecret);
    const allowed = principal.tipo === 'API_CLIENTE' && principal.scopes.includes('attractions:write') && internalNames.has(principal.nombre ?? '');
    if (!allowed) throw AppError.forbidden('Solo Order Management puede usar las rutas de compra del carrito.');
  };

  /** Turno a la venta, de esta atracción y todavía no empezado. */
  const checkSlot = async (attractionCode: string, slot: string) => {
    const time = slotTime(slot)!;
    if (isPast(time, config.timeZone, now())) {
      throw AppError.unprocessable('SLOT_IN_PAST', `El turno ${slot} ya pasó.`, [{ name: 'slot_id', reason: 'Debe ser un turno futuro.' }]);
    }
    if (!(await lookups.slotOnSale(attractionCode, time))) {
      throw AppError.unprocessable('SLOT_NOT_FOUND', `La atracción no tiene a la venta el turno ${slot}.`, [
        { name: 'slot_id', reason: 'No existe un turno a la venta de esta atracción con esa fecha y hora.' },
      ]);
    }
  };

  const view = async (usuario: string) => toCart(await repository.view(usuario), config.basePath);

  const ids = (req: Request) => {
    const cartId = parseId(String(req.params.cartId));
    const itemId = parseId(String(req.params.itemId));
    if (!cartId || !itemId) throw itemNotFound();
    return { cartId, itemId };
  };
  const internalItem = (row: ItemRow | null) => {
    if (!row) throw itemNotFound();
    return toItem(row);
  };

  const api = Router();

  api.get('/carrito', async (_req, res) => {
    res.json(await view(await user()));
  });

  api.delete('/carrito', async (_req, res) => {
    const usuario = await user();
    await repository.clear(usuario);
    res.json(await view(usuario));
  });

  api.post('/carrito/items', async (req, res) => {
    const usuario = await user();
    const input = parseItem(req.body);
    const code = await lookups.attractionCode(input.attractionId);
    if (!code) {
      throw AppError.unprocessable('ATTRACTION_NOT_FOUND', `No existe una atracción activa con el identificador '${input.attractionId}'.`, [
        { name: 'attraction_id', reason: 'Atracción inexistente o inactiva.' },
      ]);
    }
    if (input.slot) await checkSlot(code, input.slot);
    const added = await repository.addItem(usuario, { attractionCode: code, slot: input.slot, counts: input.counts }, config.maxItems);
    if (added.result === 'FULL') throw AppError.conflict('CART_FULL', `El carrito admite como máximo ${config.maxItems} ítems.`);
    if (added.result === 'IN_PAYMENT') throw inPayment();
    if (added.result === 'CREATED') res.status(201).location(`${config.basePath}/carrito/items/${added.itemId}`);
    res.json(await view(usuario));
  });

  api.patch('/carrito/items/:itemId', async (req, res) => {
    const usuario = await user();
    const itemId = parseId(String(req.params.itemId));
    if (!itemId) throw itemNotFound();
    const patch = parseItemPatch(req.body);
    const item = await repository.findUserItem(usuario, itemId);
    if (!item) throw itemNotFound();
    assertEditable(stateOf(item));
    const counts: TicketCounts = { ...countsOf(item), ...patch.counts };
    checkCounts(counts);
    const slot = patch.slot === undefined ? item.dis_slot_codigo : patch.slot;
    if (slot && slot !== item.dis_slot_codigo) await checkSlot(item.atr_codigo.trim(), slot);
    const result = await repository.updateItem(usuario, itemId, { slot, counts });
    if (result === 'NOT_FOUND') throw itemNotFound();
    if (result === 'IN_PAYMENT') throw inPayment();
    if (result === 'DUPLICATE') throw AppError.conflict('CART_ITEM_DUPLICATE', 'Ya tienes en el carrito esa atracción con ese turno.');
    res.json(await view(usuario));
  });

  api.delete('/carrito/items/:itemId', async (req, res) => {
    const usuario = await user();
    const itemId = parseId(String(req.params.itemId));
    if (!itemId) throw itemNotFound();
    const result = await repository.removeItem(usuario, itemId);
    if (result === 'NOT_FOUND') throw itemNotFound();
    if (result === 'IN_PAYMENT') throw inPayment();
    res.json(await view(usuario));
  });

  // Compra de un ítem (uso interno de Order): cada atracción se paga por separado.
  api.get('/carritos/:cartId/items/:itemId', async (req, res) => {
    await internalService();
    const { cartId, itemId } = ids(req);
    res.json(internalItem(await repository.getItem(cartId, itemId)));
  });

  api.post('/carritos/:cartId/items/:itemId/orden', async (req, res) => {
    await internalService();
    const { cartId, itemId } = ids(req);
    const key = parseIdempotencyKey(req.headers['idempotency-key']);
    const orderNumber = parseOrderNumber(req.body);
    res.json(internalItem(await repository.startPayment(cartId, itemId, orderNumber, key)));
  });

  api.post('/carritos/:cartId/items/:itemId/orden/confirmacion', async (req, res) => {
    await internalService();
    const { cartId, itemId } = ids(req);
    res.json(internalItem(await repository.confirmPurchase(cartId, itemId, parseOrderNumber(req.body))));
  });

  api.post('/carritos/:cartId/items/:itemId/orden/liberacion', async (req, res) => {
    await internalService();
    const { cartId, itemId } = ids(req);
    res.json(internalItem(await repository.releasePayment(cartId, itemId, parseOrderNumber(req.body))));
  });

  const health = () => checkHealth('ms-cart', dataSource);
  const app = createHttpService({
    service: 'ms-cart',
    logger: deps.logger,
    health,
    routes: (a) => {
      // `/health` lo agrega createHttpService; el contrato lo publica también bajo el prefijo.
      a.get(`${config.basePath}/health`, async (_req, res) => {
        const report = await health();
        res.status(report.status === 'UP' ? 200 : 503).json(report);
      });
      a.use(config.basePath, api);
    },
  });
  return { app, repository };
}
