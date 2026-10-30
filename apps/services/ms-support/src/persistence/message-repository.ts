import { AppError, returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { MessageFilters, MessageInput } from '../application/message-input';
import { ESTADOS_MENSAJE, type ContactMessageDto, type ContactSummaryDto, type MessageStatus } from '../contract';

/** Columnas con los nombres de la respuesta que tenía Audit. */
const COLUMNS = `men_id::text AS id, usu_id AS usuario_id, men_nombre AS nombre, men_correo AS email, men_asunto AS asunto,
  men_cuerpo AS mensaje, men_estado AS estado, men_correlation_id AS correlation_id, men_creado_en AS creado_en,
  men_respondido_en AS respondido_en`;

const toDto = (row: Record<string, unknown>): ContactMessageDto => ({
  ...(row as unknown as ContactMessageDto),
  creado_en: new Date(row.creado_en as string).toISOString(),
  respondido_en: row.respondido_en ? new Date(row.respondido_en as string).toISOString() : null,
});

/** Límite del formulario público: mensajes por correo en una ventana. */
export interface RateLimit {
  max: number;
  windowSeconds: number;
}

export interface NewMessage extends MessageInput {
  userId: string | null;
  correlationId: string;
}

/** Mensajes de contacto y su seguimiento. */
export class MessageRepository {
  constructor(private readonly db: DataSource) {}

  /**
   * Guarda el mensaje si el correo no superó el límite. Los envíos del mismo correo se serializan para que dos
   * simultáneos no pasen los dos. Si lo superó: 429 con los segundos hasta que se libere un lugar.
   */
  async create(message: NewMessage, limit: RateLimit): Promise<ContactMessageDto> {
    return this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('mensaje_contacto:' || $1))`, [message.correo]);
      // El mensaje que sale primero de la ventana entre los `max` más recientes: si existe, el límite está lleno.
      const [oldest]: { segundos: number }[] = await m.query(
        `SELECT ceil(extract(epoch FROM men_creado_en + make_interval(secs => $2) - now()))::int AS segundos
           FROM mensaje_contacto
          WHERE men_correo = $1 AND men_creado_en > now() - make_interval(secs => $2)
          ORDER BY men_creado_en DESC
          OFFSET $3 - 1 LIMIT 1`,
        [message.correo, limit.windowSeconds, limit.max],
      );
      if (oldest) {
        const retryAfter = Math.max(1, oldest.segundos);
        throw new TooManyMessages(retryAfter, limit);
      }
      const [row] = await m.query(
        `INSERT INTO mensaje_contacto (usu_id, men_nombre, men_correo, men_asunto, men_cuerpo, men_correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
        [message.userId, message.nombre, message.correo, message.asunto, message.cuerpo, message.correlationId],
      );
      return toDto(row);
    });
  }

  /** Más recientes primero; `search` busca en nombre, correo y asunto. */
  async list(filters: MessageFilters): Promise<{ total: number; items: ContactMessageDto[] }> {
    const where = `($1::varchar IS NULL OR men_estado = $1)
      AND ($2::varchar IS NULL OR men_nombre ILIKE '%' || $2 || '%' OR men_correo ILIKE '%' || $2 || '%' OR men_asunto ILIKE '%' || $2 || '%')`;
    const params = [filters.estado, filters.search?.replace(/[\\%_]/g, (c) => `\\${c}`) ?? null];
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM mensaje_contacto WHERE ${where}`, params);
    const rows = await this.db.query(
      `SELECT ${COLUMNS} FROM mensaje_contacto WHERE ${where} ORDER BY men_creado_en DESC, men_id DESC LIMIT $3 OFFSET $4`,
      [...params, filters.limit, filters.offset],
    );
    return { total, items: rows.map(toDto) };
  }

  /** Cantidad por estado, con ceros para los estados sin mensajes. */
  async summary(): Promise<ContactSummaryDto> {
    const rows: { estado: MessageStatus; total: number }[] = await this.db.query(
      `SELECT men_estado AS estado, count(*)::int AS total FROM mensaje_contacto GROUP BY men_estado`,
    );
    const result = Object.fromEntries(ESTADOS_MENSAJE.map((e) => [e, 0])) as ContactSummaryDto;
    for (const r of rows) result[r.estado] = r.total;
    return result;
  }

  /**
   * Cambia el estado; `respondido_en` se fija la primera vez que pasa a RESPONDIDO o CERRADO y se borra si vuelve a
   * NUEVO o EN_PROCESO (igual que en Audit). `null` si el mensaje no existe.
   */
  async setStatus(id: number, estado: MessageStatus): Promise<ContactMessageDto | null> {
    const [row] = returnedRows<Record<string, unknown>>(await this.db.query(
      `UPDATE mensaje_contacto SET men_estado = $2::varchar,
              men_respondido_en = CASE WHEN $2::varchar IN ('RESPONDIDO', 'CERRADO') THEN coalesce(men_respondido_en, now()) ELSE NULL END
        WHERE men_id = $1 RETURNING ${COLUMNS}`,
      [id, estado],
    ));
    return row ? toDto(row) : null;
  }
}

/** 429 del formulario público; `retryAfter` va en la cabecera `Retry-After`. */
export class TooManyMessages extends AppError {
  constructor(readonly retryAfter: number, limit: RateLimit) {
    super(429, 'TOO_MANY_REQUESTS', `Ya envió ${limit.max} mensajes en la última hora. Intente de nuevo en ${Math.ceil(retryAfter / 60)} minutos.`, {
      title: 'Demasiados mensajes',
    });
  }
}
