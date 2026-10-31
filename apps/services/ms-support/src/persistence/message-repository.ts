import { returnedRows } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { MensajeDto, MensajeInput } from '../contract';

interface MessageRow {
  men_id: string;
  men_nombre: string;
  men_correo: string;
  men_asunto: string;
  men_cuerpo: string;
  men_leido: boolean;
  men_creado_en: Date;
}

const COLUMNS = 'men_id, men_nombre, men_correo, men_asunto, men_cuerpo, men_leido, men_creado_en';

const toDto = (row: MessageRow): MensajeDto => ({
  id: Number(row.men_id),
  nombre: row.men_nombre,
  correo: row.men_correo,
  asunto: row.men_asunto,
  cuerpo: row.men_cuerpo,
  leido: row.men_leido,
  creado_en: row.men_creado_en.toISOString(),
});

export class MessageRepository {
  constructor(private readonly db: DataSource) {}

  async create(input: MensajeInput): Promise<{ id: number; creado_en: string }> {
    const [row] = await this.db.query(
      `INSERT INTO mensaje_contacto (men_nombre, men_correo, men_asunto, men_cuerpo) VALUES ($1, $2, $3, $4) RETURNING men_id, men_creado_en`,
      [input.nombre, input.correo, input.asunto, input.cuerpo],
    );
    return { id: Number(row.men_id), creado_en: row.men_creado_en.toISOString() };
  }

  async list(leido: boolean | null, page: number, limit: number): Promise<{ total: number; items: MensajeDto[] }> {
    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM mensaje_contacto WHERE $1::boolean IS NULL OR men_leido = $1`, [leido]);
    const rows: MessageRow[] = await this.db.query(
      `SELECT ${COLUMNS} FROM mensaje_contacto WHERE $1::boolean IS NULL OR men_leido = $1 ORDER BY men_creado_en DESC, men_id DESC LIMIT $2 OFFSET $3`,
      [leido, limit, (page - 1) * limit],
    );
    return { total, items: rows.map(toDto) };
  }

  async setRead(id: number, leido: boolean): Promise<MensajeDto | null> {
    const rows = returnedRows<MessageRow>(await this.db.query(`UPDATE mensaje_contacto SET men_leido = $2 WHERE men_id = $1 RETURNING ${COLUMNS}`, [id, leido]));
    return rows.length > 0 ? toDto(rows[0]) : null;
  }
}
