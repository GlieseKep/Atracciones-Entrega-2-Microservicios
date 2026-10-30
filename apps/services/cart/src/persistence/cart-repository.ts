import { returnedRows } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';

export interface CartTicket {
  ticket_type: string;
  cantidad: number;
}

export interface CartItem {
  id: string;
  atraccion_codigo: string;
  fecha: string;
  hora: string;
  boletos: CartTicket[];
  agregado_en: string;
}

export interface Cart {
  id: string | null;
  estado: string;
  items: CartItem[];
  actualizado_en: string | null;
  expira_en: string | null;
}

/** Días sin cambios tras los que un carrito activo se da por abandonado. */
export const CART_TTL_DAYS = 30;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

/** Acceso a cart_db con SQL explícito. */
export class CartRepository {
  constructor(private readonly db: DataSource) {}

  /** Carrito activo del usuario (los vencidos pasan a ABANDONADO al consultarlos). */
  async active(usuarioId: string, m: DataSource | EntityManager = this.db): Promise<{ id: string; actualizado_en: Date; expira_en: Date } | null> {
    await m.query(`UPDATE carrito SET estado = 'ABANDONADO', actualizado_en = now() WHERE usuario_id = $1 AND estado = 'ACTIVO' AND expira_en < now()`, [usuarioId]);
    const [row] = await m.query(`SELECT id, actualizado_en, expira_en FROM carrito WHERE usuario_id = $1 AND estado = 'ACTIVO'`, [usuarioId]);
    return row ?? null;
  }

  async get(usuarioId: string): Promise<Cart> {
    const cart = await this.active(usuarioId);
    if (!cart) return { id: null, estado: 'VACIO', items: [], actualizado_en: null, expira_en: null };
    const rows: { id: string; atraccion_codigo: string; fecha: string; hora: string; agregado_en: Date; boletos: CartTicket[] }[] = await this.db.query(
      `SELECT i.id, i.atraccion_codigo, i.fecha::text AS fecha, i.hora::text AS hora, i.agregado_en,
              coalesce(json_agg(json_build_object('ticket_type', b.tipo_boleto, 'cantidad', b.cantidad) ORDER BY b.tipo_boleto)
                       FILTER (WHERE b.tipo_boleto IS NOT NULL), '[]') AS boletos
         FROM carrito_item i LEFT JOIN carrito_item_boleto b ON b.carrito_item_id = i.id
        WHERE i.carrito_id = $1 GROUP BY i.id ORDER BY i.agregado_en, i.id`,
      [cart.id],
    );
    return {
      id: cart.id,
      estado: 'ACTIVO',
      items: rows.map((r) => ({ ...r, atraccion_codigo: r.atraccion_codigo.trim(), agregado_en: iso(r.agregado_en) })),
      actualizado_en: iso(cart.actualizado_en),
      expira_en: iso(cart.expira_en),
    };
  }

  /** Agrega un turno al carrito; si ya estaba, reemplaza sus boletos. Crea el carrito si no hay uno activo. */
  async upsertItem(usuarioId: string, item: { atraccion_codigo: string; fecha: string; hora: string; boletos: CartTicket[] }, maxItems: number): Promise<'OK' | 'FULL'> {
    return this.db.transaction(async (m) => {
      let cart = await this.active(usuarioId, m);
      if (!cart) {
        [cart] = await m.query(
          `INSERT INTO carrito (usuario_id, expira_en) VALUES ($1, now() + make_interval(days => $2)) RETURNING id, actualizado_en, expira_en`,
          [usuarioId, CART_TTL_DAYS],
        );
      }
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM carrito_item WHERE carrito_id = $1 AND NOT (atraccion_codigo = $2 AND fecha = $3::date AND hora = $4::time)`,
        [cart!.id, item.atraccion_codigo, item.fecha, item.hora],
      );
      if (n >= maxItems) return 'FULL';
      const [row] = await m.query(
        `INSERT INTO carrito_item (carrito_id, atraccion_codigo, fecha, hora) VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT uq_carrito_item_turno DO UPDATE SET agregado_en = carrito_item.agregado_en
         RETURNING id`,
        [cart!.id, item.atraccion_codigo, item.fecha, item.hora],
      );
      await this.replaceTickets(m, row.id, item.boletos);
      await this.touch(m, cart!.id);
      return 'OK';
    });
  }

  /** Cambia los boletos de un ítem del carrito activo del usuario; `false` si el ítem no es suyo o no existe. */
  async updateItem(usuarioId: string, itemId: string, boletos: CartTicket[]): Promise<boolean> {
    return this.db.transaction(async (m) => {
      const cartId = await this.ownedItemCart(m, usuarioId, itemId);
      if (!cartId) return false;
      await this.replaceTickets(m, itemId, boletos);
      await this.touch(m, cartId);
      return true;
    });
  }

  async removeItems(usuarioId: string, itemIds: string[]): Promise<number> {
    if (itemIds.length === 0) return 0;
    return this.db.transaction(async (m) => {
      const cart = await this.active(usuarioId, m);
      if (!cart) return 0;
      const rows = returnedRows(await m.query(`DELETE FROM carrito_item WHERE carrito_id = $1 AND id = ANY($2::uuid[]) RETURNING id`, [cart.id, itemIds]));
      await this.touch(m, cart.id);
      return rows.length;
    });
  }

  /**
   * Quita los ítems ya comprados. Si el carrito queda vacío pasa a CONVERTIDO (la compra se hizo desde el carrito); si
   * quedan ítems sigue ACTIVO.
   */
  async markPurchased(usuarioId: string, itemIds: string[]): Promise<void> {
    await this.db.transaction(async (m) => {
      const cart = await this.active(usuarioId, m);
      if (!cart) return;
      await m.query(`DELETE FROM carrito_item WHERE carrito_id = $1 AND id = ANY($2::uuid[])`, [cart.id, itemIds]);
      const [{ n }] = await m.query(`SELECT count(*)::int AS n FROM carrito_item WHERE carrito_id = $1`, [cart.id]);
      if (n === 0) await m.query(`UPDATE carrito SET estado = 'CONVERTIDO', actualizado_en = now() WHERE id = $1`, [cart.id]);
      else await this.touch(m, cart.id);
    });
  }

  async clear(usuarioId: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const cart = await this.active(usuarioId, m);
      if (cart) await m.query(`DELETE FROM carrito_item WHERE carrito_id = $1`, [cart.id]);
    });
  }

  async favorites(usuarioId: string): Promise<{ atraccion_codigo: string; creado_en: string }[]> {
    const rows: { atraccion_codigo: string; creado_en: Date }[] = await this.db.query(
      `SELECT atraccion_codigo, creado_en FROM favorito WHERE usuario_id = $1 ORDER BY creado_en DESC`,
      [usuarioId],
    );
    return rows.map((r) => ({ atraccion_codigo: r.atraccion_codigo.trim(), creado_en: iso(r.creado_en) }));
  }

  async addFavorite(usuarioId: string, codigo: string): Promise<void> {
    await this.db.query(`INSERT INTO favorito (usuario_id, atraccion_codigo) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [usuarioId, codigo]);
  }

  async removeFavorite(usuarioId: string, codigo: string): Promise<void> {
    await this.db.query(`DELETE FROM favorito WHERE usuario_id = $1 AND atraccion_codigo = $2`, [usuarioId, codigo]);
  }

  private async ownedItemCart(m: EntityManager, usuarioId: string, itemId: string): Promise<string | null> {
    const cart = await this.active(usuarioId, m);
    if (!cart) return null;
    const [row] = await m.query(`SELECT id FROM carrito_item WHERE id = $1 AND carrito_id = $2`, [itemId, cart.id]);
    return row ? cart.id : null;
  }

  private async replaceTickets(m: EntityManager, itemId: string, boletos: CartTicket[]): Promise<void> {
    await m.query(`DELETE FROM carrito_item_boleto WHERE carrito_item_id = $1`, [itemId]);
    for (const b of boletos) {
      await m.query(`INSERT INTO carrito_item_boleto (carrito_item_id, tipo_boleto, cantidad) VALUES ($1, $2, $3)`, [itemId, b.ticket_type, b.cantidad]);
    }
  }

  /** Cada cambio renueva el vencimiento del carrito. */
  private async touch(m: EntityManager, cartId: string): Promise<void> {
    await m.query(`UPDATE carrito SET actualizado_en = now(), expira_en = now() + make_interval(days => $2) WHERE id = $1`, [cartId, CART_TTL_DAYS]);
  }
}
