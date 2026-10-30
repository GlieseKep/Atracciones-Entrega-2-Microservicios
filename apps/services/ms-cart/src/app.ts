import {
  AppError,
  checkHealth,
  checkNodeHealth,
  createHttpService,
  createLogger,
  currentContext,
  EsbClient,
  requirePrincipal,
  requireServiceToken,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express } from 'express';
import type { DataSource } from 'typeorm';
import { AvailabilityCheck } from './application/availability-check';
import { parseCartItem, parseCartItemPatch, parseIdempotencyKey, parseItemId, parseOrderNumber, parseUserId } from './application/cart-input';
import { ItemPurchase } from './application/item-purchase';
import { ticketTotal } from './contract';
import { CART_BASE_PATH } from './integration/esb-routes';
import { CartRepository, countsOf, toItemDto } from './persistence/cart-repository';

export interface MsCartConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  /** Cabecera `X-Service-Token` de las rutas `/internal/**`. */
  serviceToken: string;
  basePath: string;
  esbUrl: string;
  maxItems: number;
  nodeId: string;
  nodeCode: string;
}

export function readMsCartConfig(env: NodeJS.ProcessEnv = process.env): MsCartConfig {
  return {
    port: Number(env.PORT ?? 4012),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_cart', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    serviceToken: env.SERVICE_TOKEN ?? '',
    basePath: env.BASE_PATH ?? CART_BASE_PATH,
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    maxItems: 20,
    nodeId: env.NODE_ID ?? 'node-dilan-cart-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_CART',
  };
}

export interface MsCartDependencies {
  logger?: Logger;
  esb?: EsbClient;
}

export interface MsCartService {
  app: Express;
  cart: CartRepository;
}

const VERSION = '1.0.0';

/** Cart Service (REST, contrato `Plan/ms_cart/ms_cart-openapi.yaml`): carrito del portal. Cada atracción se paga por separado. */
export function createMsCartService(config: MsCartConfig, dataSource: DataSource, deps: MsCartDependencies = {}): MsCartService {
  const logger = deps.logger ?? createLogger('ms-cart');
  const cart = new CartRepository(dataSource);
  const purchase = new ItemPurchase(dataSource, cart);
  const availability = new AvailabilityCheck(deps.esb ?? new EsbClient(config.esbUrl));
  const internal = requireServiceToken(config.serviceToken);

  /** `usu_id` sale siempre del token, nunca del cuerpo. */
  async function currentUser(): Promise<number> {
    const principal = await requirePrincipal(config.internalTokenSecret);
    const usuId = Number(principal.id);
    if (principal.tipo !== 'USUARIO' || !Number.isSafeInteger(usuId)) throw AppError.forbidden('Esta operación es solo para usuarios.');
    return usuId;
  }

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-cart', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  // Carrito del usuario --------------------------------------------------------

  api.get('/carrito', async (_req, res) => {
    res.json(await cart.get(await currentUser()));
  });

  api.delete('/carrito', async (_req, res) => {
    const usuId = await currentUser();
    await cart.clear(usuId);
    res.json(await cart.get(usuId));
  });

  api.post('/carrito/items', async (req, res) => {
    const usuId = await currentUser();
    const input = parseCartItem(req.body);
    const codigo = await availability.attractionCode(input.attraction_id);
    if (input.slot_id) await availability.assertSlot(codigo, input.slot_id, ticketTotal(input));
    const { itemId, created } = await cart.add(usuId, { ...input, attraction_id: codigo }, config.maxItems);
    if (created) res.status(201).location(`${config.basePath}/carrito/items/${itemId}`);
    res.json(await cart.get(usuId));
  });

  api.patch('/carrito/items/:itemId', async (req, res) => {
    const usuId = await currentUser();
    const id = parseItemId(req.params.itemId);
    const { slot_id: newSlot, ...counts } = parseCartItemPatch(req.body);
    const item = await cart.findOwn(usuId, id);
    const merged = { ...countsOf(item), ...counts };
    const slotId = newSlot === undefined ? item.dis_slot_codigo : newSlot;
    if (slotId) await availability.assertSlot(item.atr_codigo, slotId, ticketTotal(merged));
    await cart.update(usuId, id, slotId, merged);
    res.json(await cart.get(usuId));
  });

  api.delete('/carrito/items/:itemId', async (req, res) => {
    const usuId = await currentUser();
    await cart.remove(usuId, parseItemId(req.params.itemId));
    res.json(await cart.get(usuId));
  });

  // Compra de un ítem (Order) --------------------------------------------------

  api.get('/internal/carrito-items/:itemId', internal, async (req, res) => {
    res.json(toItemDto(await cart.findForOrder(parseItemId(req.params.itemId), parseUserId(req.query.usu_id))));
  });

  api.post('/internal/carrito-items/:itemId/orden', internal, async (req, res) => {
    const clave = parseIdempotencyKey(currentContext()?.idempotencyKey);
    res.json(await purchase.link(parseItemId(req.params.itemId), parseOrderNumber(req.body), clave));
  });

  api.post('/internal/carrito-items/:itemId/orden/confirmacion', internal, async (req, res) => {
    res.json(await purchase.confirm(parseItemId(req.params.itemId), parseOrderNumber(req.body)));
  });

  api.post('/internal/carrito-items/:itemId/orden/liberacion', internal, async (req, res) => {
    res.json(await purchase.release(parseItemId(req.params.itemId), parseOrderNumber(req.body)));
  });

  const app = createHttpService({
    service: 'ms-cart',
    logger,
    health: () => checkHealth('ms-cart', dataSource),
    routes: (express) => express.use(config.basePath, api),
  });
  return { app, cart };
}
