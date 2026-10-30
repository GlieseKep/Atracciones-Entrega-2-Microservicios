import { createHash } from 'node:crypto';
import {
  AppError,
  checkHealth,
  createHttpService,
  createLogger,
  currentCorrelationId,
  currentPrincipal,
  isValidEmail,
  newCorrelationId,
  optionalText,
  paging,
  requireAdmin,
  returnedRows,
  TIPOS_EVENTO_PUBLICO,
  type DatabaseSettings,
  type EventBus,
  type EventEnvelope,
  type InvalidParam,
  type Logger,
} from '@atracciones/platform';
import type { Express } from 'express';
import type { DataSource } from 'typeorm';

export interface AuditConfig {
  port: number;
  database: DatabaseSettings;
  rabbitmqUrl: string | null;
  /** Verifica el principal interno (mensajes de contacto y bitácora de administración). */
  internalTokenSecret: string;
}

export function readAuditConfig(env: NodeJS.ProcessEnv = process.env): AuditConfig {
  return {
    port: Number(env.PORT ?? 4009),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/audit_db', ssl: env.DATABASE_SSL === 'true' },
    rabbitmqUrl: env.RABBITMQ_URL ?? null,
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
  };
}

export const ESTADOS_MENSAJE = ['NUEVO', 'EN_PROCESO', 'RESPONDIDO', 'CERRADO'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_COLUMNS = 'id, usuario_id, nombre, email, asunto, mensaje, estado, correlation_id, creado_en, respondido_en';
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const toMessage = (r: Record<string, unknown>) => ({
  ...r,
  creado_en: new Date(r.creado_en as string).toISOString(),
  respondido_en: r.respondido_en ? new Date(r.respondido_en as string).toISOString() : null,
});

/** `event_id` de un evento público derivado de uno interno: determinista para que reprocesar no lo duplique. */
export function publicEventId(internalId: string, publicType: string): string {
  const h = createHash('sha256').update(`${internalId}:${publicType}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Registra un evento en la bitácora y lo proyecta a los eventos públicos del contrato (plan §6.1). Idempotente por
 * `event_id`: un evento reentregado por el bus no se duplica.
 */
export async function recordAuditEvent(dataSource: DataSource, event: EventEnvelope, logger: Logger): Promise<void> {
  await dataSource.transaction(async (m) => {
    const [known] = await m.query(`SELECT nombre FROM tipo_evento WHERE nombre = $1`, [event.type]);
    if (!known) {
      logger.warn('tipo de evento no registrado: no se guarda en la bitácora', { tipo_evento: event.type, event_id: event.id });
      return;
    }
    await m.query(
      `INSERT INTO bitacora (event_id, tipo_evento, agregado_id, correlation_id, payload, ocurrido_en)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.type, event.subject, event.correlation_id, JSON.stringify(event.data), event.time],
    );
    const publics: { tipo_publico: string }[] = await m.query(
      `SELECT tipo_publico FROM tipo_evento_publico WHERE tipo_evento = $1 ORDER BY orden`,
      [event.type],
    );
    for (const p of publics) {
      await m.query(
        `INSERT INTO evento_integracion (event_id, event_type, aggregate_id, correlation_id, ocurrido_en, payload)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING`,
        [publicEventId(event.id, p.tipo_publico), p.tipo_publico, event.subject, event.correlation_id, event.time, JSON.stringify(event.data)],
      );
    }
  });
}

export interface AuditService {
  app: Express;
  /** Se suscribe a todos los eventos del bus (cola `audit`). */
  consume(bus: EventBus): Promise<void>;
}

/** Audit & Support Service (REST, plan §3.9). */
export function createAuditService(config: AuditConfig, dataSource: DataSource, logger: Logger = createLogger('audit')): AuditService {
  const app = createHttpService({
    service: 'audit',
    logger,
    health: () => checkHealth('audit', dataSource),
    routes: (a) => {
      /** Feed de eventos de integración (`GET /atracciones/eventos`): cursor `after`, `limit` y filtro `type`. */
      a.get('/eventos', async (req, res) => {
        const after = Number(req.query.after ?? 0);
        const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
        const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : null;
        if (!Number.isInteger(after) || after < 0) throw AppError.validation("'after' debe ser un entero no negativo.");
        if (type && !TIPOS_EVENTO_PUBLICO.includes(type as (typeof TIPOS_EVENTO_PUBLICO)[number])) throw AppError.validation(`Tipo de evento desconocido: ${type}.`);
        const rows = await dataSource.query(
          `SELECT sequence_number::int AS sequence_number, event_id, event_type, aggregate_id, correlation_id, ocurrido_en, payload
             FROM evento_integracion
            WHERE sequence_number > $1 AND ($2::varchar IS NULL OR event_type = $2)
            ORDER BY sequence_number LIMIT $3`,
          [after, type, limit],
        );
        res.json(rows.map((r: Record<string, unknown>) => ({ ...r, ocurrido_en: new Date(r.ocurrido_en as string).toISOString() })));
      });

      /** Formulario de contacto del portal (público: con sesión se guarda también el usuario). */
      a.post('/mensajes-contacto', async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const data = {
          nombre: text(body.nombre), email: text(body.email).toLowerCase(), asunto: text(body.asunto), mensaje: text(body.mensaje),
        };
        const invalid: InvalidParam[] = [];
        if (data.nombre.length < 2 || data.nombre.length > 200) invalid.push({ name: 'nombre', reason: 'Debe tener entre 2 y 200 caracteres.' });
        if (!isValidEmail(data.email)) invalid.push({ name: 'email', reason: 'Debe ser un correo electrónico válido.' });
        if (data.asunto.length < 3 || data.asunto.length > 200) invalid.push({ name: 'asunto', reason: 'Debe tener entre 3 y 200 caracteres.' });
        if (data.mensaje.length < 10 || data.mensaje.length > 4000) invalid.push({ name: 'mensaje', reason: 'Debe tener entre 10 y 4000 caracteres.' });
        if (invalid.length) throw AppError.validation('El mensaje de contacto no es válido.', invalid);
        const principal = config.internalTokenSecret ? await currentPrincipal(config.internalTokenSecret) : null;
        const [row] = await dataSource.query(
          `INSERT INTO mensaje_contacto (usuario_id, nombre, email, asunto, mensaje, correlation_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${MESSAGE_COLUMNS}`,
          [principal?.tipo === 'USUARIO' ? principal.id : null, data.nombre, data.email, data.asunto, data.mensaje, currentCorrelationId() ?? newCorrelationId()],
        );
        res.status(201).json(toMessage(row));
      });

      a.get('/mensajes-contacto', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        const { limit, offset } = paging(req.query);
        const estado = optionalText(req.query.estado);
        const [{ total }] = await dataSource.query(`SELECT count(*)::int AS total FROM mensaje_contacto WHERE ($1::varchar IS NULL OR estado = $1)`, [estado]);
        const rows = await dataSource.query(
          `SELECT ${MESSAGE_COLUMNS} FROM mensaje_contacto WHERE ($1::varchar IS NULL OR estado = $1) ORDER BY creado_en DESC, id LIMIT $2 OFFSET $3`,
          [estado, limit, offset],
        );
        res.json({ total, items: rows.map(toMessage) });
      });

      a.put('/mensajes-contacto/:id/estado', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        const estado = String(req.body?.estado ?? '');
        if (!ESTADOS_MENSAJE.includes(estado as (typeof ESTADOS_MENSAJE)[number])) {
          throw AppError.validation('Estado inválido.', [{ name: 'estado', reason: `Debe ser uno de ${ESTADOS_MENSAJE.join(', ')}.` }]);
        }
        const [row] = await dataSource.query(
          `UPDATE mensaje_contacto SET estado = $2::varchar,
                  respondido_en = CASE WHEN $2::varchar IN ('RESPONDIDO', 'CERRADO') THEN coalesce(respondido_en, now()) ELSE NULL END
            WHERE id = $1::uuid RETURNING ${MESSAGE_COLUMNS}`,
          [UUID.test(req.params.id) ? req.params.id : '00000000-0000-0000-0000-000000000000', estado],
        ).then((r: unknown) => returnedRows(r));
        if (!row) throw AppError.notFound('El mensaje de contacto no existe.', 'CONTACT_MESSAGE_NOT_FOUND');
        res.json(toMessage(row));
      });

      /** Bitácora de todos los servicios (auditoría): filtros por tipo, agregado, correlation_id y fechas. */
      a.get('/bitacora', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        const q = req.query;
        const { limit, offset } = paging(q, 50);
        const params = [optionalText(q.tipo_evento), optionalText(q.agregado_id), optionalText(q.correlation_id), optionalText(q.desde), optionalText(q.hasta), optionalText(q.servicio)];
        const where = `($1::varchar IS NULL OR b.tipo_evento = $1) AND ($2::varchar IS NULL OR b.agregado_id = $2)
          AND ($3::varchar IS NULL OR b.correlation_id = $3) AND ($4::date IS NULL OR b.ocurrido_en >= $4::date)
          AND ($5::date IS NULL OR b.ocurrido_en < $5::date + 1) AND ($6::varchar IS NULL OR t.servicio_origen = $6)`;
        const [{ total }] = await dataSource.query(`SELECT count(*)::int AS total FROM bitacora b JOIN tipo_evento t ON t.nombre = b.tipo_evento WHERE ${where}`, params);
        const rows = await dataSource.query(
          `SELECT b.event_id, b.tipo_evento, t.servicio_origen, t.tipo_agregado, b.agregado_id, b.correlation_id, b.payload, b.ocurrido_en
             FROM bitacora b JOIN tipo_evento t ON t.nombre = b.tipo_evento WHERE ${where}
            ORDER BY b.ocurrido_en DESC, b.id DESC LIMIT $7 OFFSET $8`,
          [...params, limit, offset],
        );
        res.json({ total, items: rows.map((r: Record<string, unknown>) => ({ ...r, ocurrido_en: new Date(r.ocurrido_en as string).toISOString() })) });
      });

      a.get('/bitacora/tipos', async (_req, res) => {
        await requireAdmin(config.internalTokenSecret);
        res.json(await dataSource.query(`SELECT nombre, servicio_origen, tipo_agregado FROM tipo_evento ORDER BY servicio_origen, nombre`));
      });
    },
  });
  return {
    app,
    consume: (bus) => bus.subscribe('audit', ['#'], (event) => recordAuditEvent(dataSource, event, logger)),
  };
}
