import { AppError, parseSlotId, returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { ticketTotal, type CartDto, type CartItemDto, type CartItemInput, type ItemStatus, type TicketCounts } from '../contract';

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
  cai_creado_en: Date;
}

const ITEM_COLUMNS = `i.cai_id, i.car_id, i.atr_codigo, i.dis_slot_codigo, i.cai_adultos, i.cai_ninos, i.cai_seniors, i.cai_estudiantes,
  i.cai_infantes, i.cai_estado, i.cai_ord_numero, i.cai_orden_clave, i.cai_creado_en`;

export const countsOf = (row: ItemRow): TicketCounts => ({
  adult_count: row.cai_adultos,
  child_count: row.cai_ninos,
  senior_count: row.cai_seniors,
  student_count: row.cai_estudiantes,
  infant_count: row.cai_infantes,
});

export function toItemDto(row: ItemRow): CartItemDto {
  const counts = countsOf(row);
  const slot = row.dis_slot_codigo ? parseSlotId(row.dis_slot_codigo) : null;
  return {
    item_id: Number(row.cai_id),
    attraction_id: row.atr_codigo,
    slot_id: row.dis_slot_codigo,
    date: slot?.date ?? null,
    time: slot?.time ?? null,
    ...counts,
    ticket_count: ticketTotal(counts),
    status: row.cai_estado,
    external_order_id: row.cai_ord_numero,
    created_at: row.cai_creado_en.toISOString(),
  };
}

const notFound = (id: number) => AppError.notFound(`No existe el ítem ${id}.`, 'CART_ITEM_NOT_FOUND');
const inPayment = () => AppError.conflict('CART_ITEM_IN_PAYMENT', 'El ítem se está pagando: no se puede cambiar ni quitar.');

export class CartRepository {
  constructor(private readonly db: DataSource) {}

  /** Carrito activo con sus ítems `PENDIENTE` y `EN_PAGO`. */
  async get(usuId: number): Promise<CartDto> {
    const [cart] = await this.db.query(`SELECT car_id, car_creado_en, car_actualizado_en FROM carrito WHERE usu_id = $1 AND car_activo`, [usuId]);
    if (!cart) return { id: null, active: true, items: [], item_count: 0, ticket_count: 0, created_at: null, updated_at: null };
    const rows: ItemRow[] = await this.db.query(
      `SELECT ${ITEM_COLUMNS} FROM carrito_item i WHERE i.car_id = $1 AND i.cai_estado <> 'COMPRADO' ORDER BY i.cai_creado_en, i.cai_id`,
      [cart.car_id],
    );
    const items = rows.map(toItemDto);
    return {
      id: Number(cart.car_id),
      active: true,
      items,
      item_count: items.length,
      ticket_count: items.reduce((sum, item) => sum + item.ticket_count, 0),
      created_at: cart.car_creado_en.toISOString(),
      updated_at: cart.car_actualizado_en.toISOString(),
    };
  }

  /** Crea o toca el carrito. La fila queda bloqueada: dos pestañas no crean dos carritos ni se pasan del tope. */
  private async lockCart(usuId: number, m: EntityManager): Promise<string> {
    const [row] = await m.query(
      `INSERT INTO carrito (usu_id) VALUES ($1) ON CONFLICT (usu_id) WHERE car_activo DO UPDATE SET car_activo = TRUE RETURNING car_id`,
      [usuId],
    );
    return row.car_id;
  }

  /** Si atracción y turno ya están en el carrito, reemplaza las cantidades. */
  add(usuId: number, input: CartItemInput, maxItems: number): Promise<{ itemId: number; created: boolean }> {
    return this.db.transaction(async (m) => {
      const carId = await this.lockCart(usuId, m);
      const [existing] = await m.query(
        `SELECT cai_id, cai_estado FROM carrito_item
         WHERE car_id = $1 AND atr_codigo = $2 AND dis_slot_codigo IS NOT DISTINCT FROM $3 AND cai_estado <> 'COMPRADO'`,
        [carId, input.attraction_id, input.slot_id],
      );
      if (existing?.cai_estado === 'EN_PAGO') throw inPayment();
      const counts = [input.adult_count, input.child_count, input.senior_count, input.student_count, input.infant_count];
      if (existing) {
        await m.query(
          `UPDATE carrito_item SET cai_adultos = $2, cai_ninos = $3, cai_seniors = $4, cai_estudiantes = $5, cai_infantes = $6 WHERE cai_id = $1`,
          [existing.cai_id, ...counts],
        );
        return { itemId: Number(existing.cai_id), created: false };
      }
      const [{ pendientes }] = await m.query(`SELECT count(*)::int AS pendientes FROM carrito_item WHERE car_id = $1 AND cai_estado = 'PENDIENTE'`, [carId]);
      if (pendientes >= maxItems) throw AppError.conflict('CART_FULL', `El carrito admite hasta ${maxItems} ítems pendientes.`);
      const [row] = await m.query(
        `INSERT INTO carrito_item (car_id, atr_codigo, dis_slot_codigo, cai_adultos, cai_ninos, cai_seniors, cai_estudiantes, cai_infantes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING cai_id`,
        [carId, input.attraction_id, input.slot_id, ...counts],
      );
      return { itemId: Number(row.cai_id), created: true };
    });
  }

  /** El ítem de otro usuario responde igual que uno inexistente. */
  async findOwn(usuId: number, id: number): Promise<ItemRow> {
    const [row] = await this.db.query(
      `SELECT ${ITEM_COLUMNS} FROM carrito_item i JOIN carrito c ON c.car_id = i.car_id
       WHERE i.cai_id = $1 AND c.usu_id = $2 AND c.car_activo AND i.cai_estado <> 'COMPRADO'`,
      [id, usuId],
    );
    if (!row) throw notFound(id);
    return row;
  }

  /** Bloquea un ítem propio y exige que siga `PENDIENTE`. */
  private async lockPending(usuId: number, id: number, m: EntityManager): Promise<void> {
    await this.lockCart(usuId, m);
    const [row] = await m.query(
      `SELECT i.cai_estado FROM carrito_item i JOIN carrito c ON c.car_id = i.car_id
       WHERE i.cai_id = $1 AND c.usu_id = $2 AND c.car_activo AND i.cai_estado <> 'COMPRADO' FOR UPDATE OF i`,
      [id, usuId],
    );
    if (!row) throw notFound(id);
    if (row.cai_estado === 'EN_PAGO') throw inPayment();
  }

  update(usuId: number, id: number, slotId: string | null, counts: TicketCounts): Promise<void> {
    return this.db.transaction(async (m) => {
      await this.lockPending(usuId, id, m);
      try {
        await m.query(
          `UPDATE carrito_item SET dis_slot_codigo = $2, cai_adultos = $3, cai_ninos = $4, cai_seniors = $5, cai_estudiantes = $6, cai_infantes = $7 WHERE cai_id = $1`,
          [id, slotId, counts.adult_count, counts.child_count, counts.senior_count, counts.student_count, counts.infant_count],
        );
      } catch (error) {
        const driver = (error as { driverError?: { code?: string } }).driverError;
        if (driver?.code === '23505') throw AppError.conflict('CART_ITEM_EXISTS', 'Ya hay un ítem con esa atracción y ese turno.');
        throw error;
      }
    });
  }

  remove(usuId: number, id: number): Promise<void> {
    return this.db.transaction(async (m) => {
      await this.lockPending(usuId, id, m);
      await m.query(`DELETE FROM carrito_item WHERE cai_id = $1`, [id]);
    });
  }

  /** Quita los `PENDIENTE`; los `EN_PAGO` esperan a Order. */
  async clear(usuId: number): Promise<void> {
    await this.db.query(
      `DELETE FROM carrito_item WHERE cai_estado = 'PENDIENTE' AND car_id IN (SELECT car_id FROM carrito WHERE usu_id = $1 AND car_activo)`,
      [usuId],
    );
    await this.db.query(`UPDATE carrito SET car_activo = TRUE WHERE usu_id = $1 AND car_activo`, [usuId]);
  }

  // Compra de un ítem ----------------------------------------------------------

  async findForOrder(id: number, usuId: number): Promise<ItemRow> {
    const [row] = await this.db.query(`SELECT ${ITEM_COLUMNS} FROM carrito_item i JOIN carrito c ON c.car_id = i.car_id WHERE i.cai_id = $1 AND c.usu_id = $2`, [id, usuId]);
    if (!row) throw notFound(id);
    return row;
  }

  /** Bloquea el ítem para una transición de compra. */
  async lockItem(id: number, m: EntityManager): Promise<ItemRow> {
    const [row] = await m.query(`SELECT ${ITEM_COLUMNS} FROM carrito_item i WHERE i.cai_id = $1 FOR UPDATE`, [id]);
    if (!row) throw notFound(id);
    return row;
  }

  async setInPayment(id: number, ordNumero: string, clave: string, m: EntityManager): Promise<ItemRow> {
    return this.singleRow(m, `UPDATE carrito_item i SET cai_estado = 'EN_PAGO', cai_ord_numero = $2, cai_orden_clave = $3, cai_en_pago_desde = now() WHERE i.cai_id = $1 RETURNING ${ITEM_COLUMNS}`, [id, ordNumero, clave]);
  }

  async setBought(id: number, m: EntityManager): Promise<ItemRow> {
    return this.singleRow(m, `UPDATE carrito_item i SET cai_estado = 'COMPRADO', cai_comprado_en = now() WHERE i.cai_id = $1 RETURNING ${ITEM_COLUMNS}`, [id]);
  }

  async setPending(id: number, m: EntityManager): Promise<ItemRow> {
    return this.singleRow(
      m,
      `UPDATE carrito_item i SET cai_estado = 'PENDIENTE', cai_ord_numero = NULL, cai_orden_clave = NULL, cai_en_pago_desde = NULL WHERE i.cai_id = $1 RETURNING ${ITEM_COLUMNS}`,
      [id],
    );
  }

  private async singleRow(m: EntityManager, sql: string, params: unknown[]): Promise<ItemRow> {
    return returnedRows<ItemRow>(await m.query(sql, params))[0];
  }

  /** Carritos sin cambios y sin ítems en pago. Devuelve cuántos se desactivaron. */
  async deactivateAbandoned(days: number): Promise<number> {
    const rows = returnedRows(
      await this.db.query(
        `UPDATE carrito c SET car_activo = FALSE
         WHERE c.car_activo AND c.car_actualizado_en < now() - make_interval(days => $1)
           AND NOT EXISTS (SELECT 1 FROM carrito_item i WHERE i.car_id = c.car_id AND i.cai_estado = 'EN_PAGO')
         RETURNING c.car_id`,
        [days],
      ),
    );
    return rows.length;
  }
}
