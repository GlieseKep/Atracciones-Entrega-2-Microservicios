import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { TicketCounts } from '../application/cart-input';
import { decideConfirm, decideRelease, decideStart, type Decision, type ItemStatus, type PurchaseState } from '../application/item-purchase';

export interface CartRow {
  car_id: string;
  car_activo: boolean;
  car_creado_en: Date;
  car_actualizado_en: Date;
}

export interface ItemRow {
  cai_id: string;
  car_id: string;
  atr_codigo: string;
  dis_slot_codigo: string | null;
  cai_adultos: number;
  cai_ninos: number;
  cai_seniors: number;
  cai_estudiantes: number;
  cai_infantes: number;
  cai_estado: ItemStatus;
  cai_ord_numero: string | null;
  cai_orden_clave: string | null;
  cai_en_pago_desde: Date | null;
  cai_comprado_en: Date | null;
  cai_creado_en: Date;
}

/** Carrito activo del usuario con sus ítems visibles (pendientes y en pago). */
export interface CartView {
  cart: CartRow | null;
  items: ItemRow[];
}

export interface NewItem {
  attractionCode: string;
  slot: string | null;
  counts: TicketCounts;
}

export type AddResult = { result: 'CREATED' | 'UPDATED'; itemId: string } | { result: 'FULL' | 'IN_PAYMENT' };

const ITEM_COLUMNS = `i.cai_id, i.car_id, i.atr_codigo, i.dis_slot_codigo, i.cai_adultos, i.cai_ninos, i.cai_seniors, i.cai_estudiantes,
  i.cai_infantes, i.cai_estado, i.cai_ord_numero, i.cai_orden_clave, i.cai_en_pago_desde, i.cai_comprado_en, i.cai_creado_en`;

export const countsOf = (i: ItemRow): TicketCounts => ({
  adult: i.cai_adultos, child: i.cai_ninos, senior: i.cai_seniors, student: i.cai_estudiantes, infant: i.cai_infantes,
});

export const stateOf = (i: ItemRow): PurchaseState => ({
  status: i.cai_estado, slot: i.dis_slot_codigo, orderNumber: i.cai_ord_numero, orderKey: i.cai_orden_clave,
});

const isUniqueViolation = (error: unknown, constraint: string) => {
  const driver = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
  return driver?.code === '23505' && driver.constraint === constraint;
};

/** Acceso a ms_cart con SQL explícito. */
export class CartRepository {
  constructor(private readonly db: DataSource) {}

  async view(usuarioId: string): Promise<CartView> {
    const cart = await this.activeCart(this.db, usuarioId);
    if (!cart) return { cart: null, items: [] };
    const items: ItemRow[] = await this.db.query(
      `SELECT ${ITEM_COLUMNS} FROM carrito_item i WHERE i.car_id = $1 AND i.cai_estado <> 'COMPRADO' ORDER BY i.cai_creado_en, i.cai_id`,
      [cart.car_id],
    );
    return { cart, items };
  }

  /**
   * Agrega una atracción (y opcionalmente un turno). Si el par atracción + turno ya está pendiente, reemplaza sus
   * cantidades. Crea el carrito si no hay uno activo; el bloqueo del carrito ordena las peticiones simultáneas.
   */
  async addItem(usuarioId: string, item: NewItem, maxItems: number): Promise<AddResult> {
    return this.db.transaction(async (m) => {
      const cart = await this.lockedActiveCart(m, usuarioId);
      const [existing]: ItemRow[] = await m.query(
        `SELECT ${ITEM_COLUMNS} FROM carrito_item i
          WHERE i.car_id = $1 AND i.atr_codigo = $2 AND i.dis_slot_codigo IS NOT DISTINCT FROM $3 AND i.cai_estado <> 'COMPRADO'`,
        [cart.car_id, item.attractionCode, item.slot],
      );
      if (existing?.cai_estado === 'EN_PAGO') return { result: 'IN_PAYMENT' as const };
      if (existing) {
        await this.writeCounts(m, existing.cai_id, item.counts);
        await this.touch(m, cart.car_id);
        return { result: 'UPDATED' as const, itemId: existing.cai_id };
      }
      const [{ n }] = await m.query(`SELECT count(*)::int AS n FROM carrito_item WHERE car_id = $1 AND cai_estado <> 'COMPRADO'`, [cart.car_id]);
      if (n >= maxItems) return { result: 'FULL' as const };
      const c = item.counts;
      const [row] = await m.query(
        `INSERT INTO carrito_item (car_id, atr_codigo, dis_slot_codigo, cai_adultos, cai_ninos, cai_seniors, cai_estudiantes, cai_infantes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING cai_id`,
        [cart.car_id, item.attractionCode, item.slot, c.adult, c.child, c.senior, c.student, c.infant],
      );
      await this.touch(m, cart.car_id);
      return { result: 'CREATED' as const, itemId: String(row.cai_id) };
    });
  }

  /** Ítem visible del carrito activo del usuario (pendiente o en pago); `null` si no es suyo o ya se compró. */
  async findUserItem(usuarioId: string, itemId: string, m: DataSource | EntityManager = this.db, lock = false): Promise<ItemRow | null> {
    const [row] = await m.query(
      `SELECT ${ITEM_COLUMNS} FROM carrito_item i JOIN carrito c ON c.car_id = i.car_id
        WHERE c.usu_id = $1 AND c.car_activo AND i.cai_id = $2 AND i.cai_estado <> 'COMPRADO'${lock ? ' FOR UPDATE OF i' : ''}`,
      [usuarioId, itemId],
    );
    return row ?? null;
  }

  /** Cambia el turno y las cantidades de un ítem pendiente. */
  async updateItem(usuarioId: string, itemId: string, change: { slot: string | null; counts: TicketCounts }): Promise<'OK' | 'NOT_FOUND' | 'IN_PAYMENT' | 'DUPLICATE'> {
    return this.db.transaction(async (m) => {
      const item = await this.findUserItem(usuarioId, itemId, m, true);
      if (!item) return 'NOT_FOUND';
      if (item.cai_estado === 'EN_PAGO') return 'IN_PAYMENT';
      if (change.slot !== item.dis_slot_codigo) {
        const [other] = await m.query(
          `SELECT 1 FROM carrito_item WHERE car_id = $1 AND atr_codigo = $2 AND dis_slot_codigo IS NOT DISTINCT FROM $3
              AND cai_estado <> 'COMPRADO' AND cai_id <> $4`,
          [item.car_id, item.atr_codigo, change.slot, item.cai_id],
        );
        if (other) return 'DUPLICATE';
        await m.query(`UPDATE carrito_item SET dis_slot_codigo = $2 WHERE cai_id = $1`, [item.cai_id, change.slot]);
      }
      await this.writeCounts(m, item.cai_id, change.counts);
      await this.touch(m, item.car_id);
      return 'OK';
    });
  }

  async removeItem(usuarioId: string, itemId: string): Promise<'OK' | 'NOT_FOUND' | 'IN_PAYMENT'> {
    return this.db.transaction(async (m) => {
      const item = await this.findUserItem(usuarioId, itemId, m, true);
      if (!item) return 'NOT_FOUND';
      if (item.cai_estado === 'EN_PAGO') return 'IN_PAYMENT';
      await m.query(`DELETE FROM carrito_item WHERE cai_id = $1`, [item.cai_id]);
      await this.touch(m, item.car_id);
      return 'OK';
    });
  }

  /** Quita los ítems pendientes; los que están en pago se conservan hasta que Order confirme o libere el cobro. */
  async clear(usuarioId: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const cart = await this.activeCart(m, usuarioId);
      if (!cart) return;
      await m.query(`DELETE FROM carrito_item WHERE car_id = $1 AND cai_estado = 'PENDIENTE'`, [cart.car_id]);
      await this.touch(m, cart.car_id);
    });
  }

  /** Ítem de un carrito en cualquier estado (rutas internas de Order). */
  async getItem(cartId: string, itemId: string): Promise<ItemRow | null> {
    const [row] = await this.db.query(`SELECT ${ITEM_COLUMNS} FROM carrito_item i WHERE i.car_id = $1 AND i.cai_id = $2`, [cartId, itemId]);
    return row ?? null;
  }

  /** PENDIENTE → EN_PAGO: el ítem queda ligado a la orden que lo va a cobrar. */
  async startPayment(cartId: string, itemId: string, orderNumber: string, orderKey: string): Promise<ItemRow | null> {
    return this.transition(cartId, itemId, (s) => decideStart(s, orderNumber, orderKey), async (m, item) => {
      const [other] = await m.query(`SELECT 1 FROM carrito_item WHERE cai_ord_numero = $1 AND cai_id <> $2`, [orderNumber, item.cai_id]);
      if (other) throw AppError.conflict('ORDER_ALREADY_LINKED', `La orden ${orderNumber} ya está ligada a otro ítem.`);
      await m.query(
        `UPDATE carrito_item SET cai_estado = 'EN_PAGO', cai_ord_numero = $2, cai_orden_clave = $3, cai_en_pago_desde = now() WHERE cai_id = $1`,
        [item.cai_id, orderNumber, orderKey],
      );
    });
  }

  /** EN_PAGO → COMPRADO, tras el pago aprobado. */
  async confirmPurchase(cartId: string, itemId: string, orderNumber: string): Promise<ItemRow | null> {
    return this.transition(cartId, itemId, (s) => decideConfirm(s, orderNumber), (m, item) =>
      m.query(`UPDATE carrito_item SET cai_estado = 'COMPRADO', cai_comprado_en = now() WHERE cai_id = $1`, [item.cai_id]));
  }

  /** EN_PAGO → PENDIENTE, si el pago se rechazó o falló: el ítem vuelve al carrito sin orden. */
  async releasePayment(cartId: string, itemId: string, orderNumber: string): Promise<ItemRow | null> {
    return this.transition(cartId, itemId, (s) => decideRelease(s, orderNumber), (m, item) =>
      m.query(
        `UPDATE carrito_item SET cai_estado = 'PENDIENTE', cai_ord_numero = NULL, cai_orden_clave = NULL, cai_en_pago_desde = NULL WHERE cai_id = $1`,
        [item.cai_id],
      ));
  }

  /** Desactiva los carritos sin cambios en `days` días y sin ítems en pago. Devuelve cuántos. */
  async abandonIdle(days: number): Promise<number> {
    const rows = returnedRows(await this.db.query(
      `UPDATE carrito c SET car_activo = FALSE
        WHERE c.car_activo AND c.car_actualizado_en < now() - make_interval(days => $1)
          AND NOT EXISTS (SELECT 1 FROM carrito_item i WHERE i.car_id = c.car_id AND i.cai_estado = 'EN_PAGO')
        RETURNING c.car_id`,
      [days],
    ));
    return rows.length;
  }

  private async transition(
    cartId: string,
    itemId: string,
    decide: (state: PurchaseState) => Decision,
    apply: (m: EntityManager, item: ItemRow) => Promise<unknown>,
  ): Promise<ItemRow | null> {
    try {
      return await this.db.transaction(async (m) => {
        const [item]: ItemRow[] = await m.query(`SELECT ${ITEM_COLUMNS} FROM carrito_item i WHERE i.car_id = $1 AND i.cai_id = $2 FOR UPDATE`, [cartId, itemId]);
        if (!item) return null;
        if (decide(stateOf(item)) === 'noop') return item;
        await apply(m, item);
        await this.touch(m, item.car_id);
        const [updated]: ItemRow[] = await m.query(`SELECT ${ITEM_COLUMNS} FROM carrito_item i WHERE i.cai_id = $1`, [item.cai_id]);
        return updated;
      });
    } catch (error) {
      // Dos ítems ligados a la misma orden a la vez: lo impide la UNIQUE aunque la consulta previa no lo viera.
      if (isUniqueViolation(error, 'uq_carrito_item_ord_numero')) throw AppError.conflict('ORDER_ALREADY_LINKED', 'La orden ya está ligada a otro ítem.');
      throw error;
    }
  }

  private async activeCart(m: DataSource | EntityManager, usuarioId: string): Promise<CartRow | null> {
    const [row] = await m.query(`SELECT car_id, car_activo, car_creado_en, car_actualizado_en FROM carrito WHERE usu_id = $1 AND car_activo`, [usuarioId]);
    return row ?? null;
  }

  /** Carrito activo bloqueado para la transacción; lo crea si no existe (el índice parcial evita duplicados). */
  private async lockedActiveCart(m: EntityManager, usuarioId: string): Promise<CartRow> {
    await m.query(`INSERT INTO carrito (usu_id) VALUES ($1) ON CONFLICT (usu_id) WHERE car_activo DO NOTHING`, [usuarioId]);
    const [row] = await m.query(
      `SELECT car_id, car_activo, car_creado_en, car_actualizado_en FROM carrito WHERE usu_id = $1 AND car_activo FOR UPDATE`,
      [usuarioId],
    );
    return row;
  }

  private async writeCounts(m: EntityManager, itemId: string, c: TicketCounts): Promise<void> {
    await m.query(
      `UPDATE carrito_item SET cai_adultos = $2, cai_ninos = $3, cai_seniors = $4, cai_estudiantes = $5, cai_infantes = $6 WHERE cai_id = $1`,
      [itemId, c.adult, c.child, c.senior, c.student, c.infant],
    );
  }

  /** Cada cambio renueva `car_actualizado_en` (lo usa la tarea de carritos abandonados). */
  private async touch(m: EntityManager, cartId: string): Promise<void> {
    await m.query(`UPDATE carrito SET car_actualizado_en = now() WHERE car_id = $1`, [cartId]);
  }
}
