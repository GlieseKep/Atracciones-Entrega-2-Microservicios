import { randomBytes } from 'node:crypto';
import {
  AppError,
  checkHealth,
  createHttpService,
  METODOS_PAGO,
  money,
  optionalText,
  paging,
  recordEvent,
  requireAdmin,
  SOLICITANTES_CANCELACION,
  type DatabaseSettings,
} from '@atracciones/platform';
import type { Express } from 'express';
import type { DataSource, EntityManager } from 'typeorm';

export interface PaymentConfig {
  port: number;
  database: DatabaseSettings;
  /** Verifica el principal interno de las consultas de pagos (administración y Order). */
  internalTokenSecret: string;
}

export function readPaymentConfig(env: NodeJS.ProcessEnv = process.env): PaymentConfig {
  return {
    port: Number(env.PORT ?? 4007),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/payment_db', ssl: env.DATABASE_SSL === 'true' },
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
  };
}

type Metodo = (typeof METODOS_PAGO)[number];

/**
 * Pasarela de tarjetas simulada (la misma regla del monolito, al estilo de las tarjetas de prueba): centavos `.51` →
 * rechazo por fondos insuficientes; `.52` → falla técnica de la pasarela (503, la saga compensa); otro → aprobado.
 */
export function simulateCard(amount: number): { estado: 'APROBADO' | 'RECHAZADO'; codigo: string; mensaje: string } {
  const cents = Math.round(amount * 100) % 100;
  if (cents === 52) throw AppError.unavailable('La pasarela de pagos simulada no respondió.');
  if (cents === 51) return { estado: 'RECHAZADO', codigo: '51', mensaje: 'Fondos insuficientes (simulado).' };
  return { estado: 'APROBADO', codigo: '00', mensaje: 'Aprobado (simulado).' };
}

const reference = (prefix: string) => `${prefix}-${randomBytes(6).toString('hex').toUpperCase()}`;

interface PagoRow {
  pago_id: string;
  estado: string;
  monto: string;
  motivo_rechazo: string | null;
  referencia_pasarela: string | null;
}

const toPago = (row: PagoRow) => ({ ...row, monto: Number(row.monto) });

export interface PaymentService {
  app: Express;
}

/** Payment Service (REST, plan §3.7). */
export function createPaymentService(config: PaymentConfig, dataSource: DataSource): PaymentService {
  const findByKey = async (m: DataSource | EntityManager, clave: string): Promise<PagoRow | null> => {
    const [row] = await m.query(
      `SELECT id AS pago_id, estado, monto, motivo_rechazo, referencia_pasarela FROM pago WHERE clave_idempotencia = $1`,
      [clave],
    );
    return row ?? null;
  };

  const app = createHttpService({
    service: 'payment',
    health: () => checkHealth('payment', dataSource),
    routes: (a) => {
      /** Registra el pago de una orden (paso de la saga). Idempotente por `clave_idempotencia`. */
      a.post('/pagos', async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const metodo = body.metodo_pago as Metodo;
        const monto = Number(body.monto);
        const clave = typeof body.clave_idempotencia === 'string' ? body.clave_idempotencia : '';
        if (!METODOS_PAGO.includes(metodo) || !(monto >= 0) || !clave || typeof body.orden_id !== 'string') {
          throw AppError.validation('Pago inválido: se requieren orden_id, metodo_pago, monto y clave_idempotencia.');
        }
        const previous = await findByKey(dataSource, clave);
        if (previous) return void res.status(200).json(toPago(previous));

        const tarjeta = metodo === 'TARJETA_CREDITO' ? simulateCard(monto) : null;
        const estado = metodo === 'SOA_BOOKING_GATEWAY' ? 'APROBADO' : tarjeta ? tarjeta.estado : 'PENDIENTE';
        const pago = await dataSource.transaction(async (m) => {
          const [row] = await m.query(
            `INSERT INTO pago (orden_id, metodo_pago, estado, monto, moneda, referencia_externa, referencia_pasarela, motivo_rechazo, clave_idempotencia, procesado_en)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING id AS pago_id, estado, monto, motivo_rechazo, referencia_pasarela`,
            [body.orden_id, metodo, estado, money(monto), (body.moneda as string) ?? 'USD', (body.referencia_externa as string) || null,
              reference('PAY'), estado === 'RECHAZADO' ? tarjeta!.mensaje : null, clave, estado === 'PENDIENTE' ? null : new Date()],
          );
          if (tarjeta) {
            await m.query(
              `INSERT INTO pago_tarjeta (pago_id, marca, ultimos_4, codigo_autorizacion, codigo_respuesta, mensaje_respuesta) VALUES ($1, 'SIMULADA', '0000', $2, $3, $4)`,
              [row.pago_id, tarjeta.estado === 'APROBADO' ? reference('AUT') : null, tarjeta.codigo, tarjeta.mensaje],
            );
          }
          if (metodo === 'TRANSFERENCIA') await m.query(`INSERT INTO pago_transferencia (pago_id) VALUES ($1)`, [row.pago_id]);
          if (estado !== 'PENDIENTE') {
            await recordEvent(m, {
              tipoEvento: estado === 'APROBADO' ? 'PagoAprobado' : 'PagoRechazado',
              agregadoId: row.pago_id,
              payload: { pago_id: row.pago_id, orden_id: body.orden_id, metodo_pago: metodo, monto: money(monto), estado },
            });
          }
          return row as PagoRow;
        });
        res.status(201).json(toPago(pago));
      });

      /** Anula el pago registrado con una clave (compensación de la saga). Idempotente. */
      a.post('/pagos/anulacion', async (req, res) => {
        const clave = typeof req.body?.clave_idempotencia === 'string' ? req.body.clave_idempotencia : '';
        const pago = await dataSource.transaction(async (m) => {
          const [row] = await m.query(`SELECT id, estado FROM pago WHERE clave_idempotencia = $1 FOR UPDATE`, [clave]);
          if (!row) return { anulado: false, estado: null };
          if (row.estado !== 'APROBADO' && row.estado !== 'PENDIENTE') return { anulado: false, estado: row.estado };
          await m.query(`UPDATE pago SET estado = 'ANULADO', procesado_en = now() WHERE id = $1`, [row.id]);
          return { anulado: true, estado: 'ANULADO' };
        });
        res.json(pago);
      });

      /** Reembolsa (total o parcial) el pago de una orden. Idempotente por `clave_idempotencia`. */
      a.post('/reembolsos', async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const clave = typeof body.clave_idempotencia === 'string' ? body.clave_idempotencia : '';
        const clavePago = typeof body.clave_pago === 'string' ? body.clave_pago : '';
        const solicitante = (body.solicitante as string) ?? 'CLIENTE';
        if (!clave || !clavePago || !SOLICITANTES_CANCELACION.includes(solicitante as (typeof SOLICITANTES_CANCELACION)[number])) {
          throw AppError.validation('Reembolso inválido: se requieren clave_pago, clave_idempotencia y un solicitante válido.');
        }
        const result = await dataSource.transaction(async (m) => {
          const [existing] = await m.query(`SELECT codigo, monto, estado FROM reembolso WHERE clave_idempotencia = $1`, [clave]);
          if (existing) return { reembolso_codigo: existing.codigo, monto: Number(existing.monto), estado: existing.estado };
          const [pago] = await m.query(
            `SELECT p.id, p.estado, p.orden_id, s.saldo FROM pago p JOIN v_pago_saldo s ON s.pago_id = p.id WHERE p.clave_idempotencia = $1 FOR UPDATE OF p`,
            [clavePago],
          );
          // Sin pago aprobado no hay nada que devolver (p. ej. pago en sitio aún no cobrado): se anula si estaba pendiente.
          if (!pago || pago.estado !== 'APROBADO') {
            if (pago?.estado === 'PENDIENTE') await m.query(`UPDATE pago SET estado = 'ANULADO', procesado_en = now() WHERE id = $1`, [pago.id]);
            return { reembolso_codigo: null, monto: 0, estado: 'SIN_COBRO' };
          }
          const monto = money(Math.min(Number(body.monto ?? pago.saldo), Number(pago.saldo)));
          if (monto <= 0) return { reembolso_codigo: null, monto: 0, estado: 'SIN_SALDO' };
          const codigo = `REF-ATR-${randomBytes(4).toString('hex').toUpperCase()}`;
          await m.query(
            `INSERT INTO reembolso (codigo, pago_id, monto, motivo, solicitante, estado, clave_idempotencia, emitido_en) VALUES ($1, $2, $3, $4, $5, 'EMITIDO', $6, now())`,
            [codigo, pago.id, monto, (body.motivo as string) || 'Cancelación de la reserva', solicitante, clave],
          );
          await recordEvent(m, { tipoEvento: 'ReembolsoEmitido', agregadoId: codigo, payload: { reembolso_codigo: codigo, pago_id: pago.id, orden_id: pago.orden_id, monto } });
          return { reembolso_codigo: codigo, monto, estado: 'EMITIDO' };
        });
        res.status(201).json(result);
      });

      /** Pago registrado con una clave de idempotencia (lo pide Refund, con su cuenta de servicio, para calcular el saldo). */
      a.get('/pagos/clave/:clave', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        const [pago] = await dataSource.query(
          `SELECT id AS pago_id, orden_id, estado, monto, moneda, referencia_pasarela FROM pago WHERE clave_idempotencia = $1`,
          [req.params.clave],
        );
        if (!pago) throw AppError.notFound('No existe un pago con esa clave.', 'PAYMENT_NOT_FOUND');
        res.json({ ...pago, monto: Number(pago.monto) });
      });

      /** Pagos de una orden con sus reembolsos (lo pide Order, con su cuenta de servicio, tras verificar al dueño). */
      a.get('/pagos/orden/:orden_id', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        if (!UUID.test(req.params.orden_id)) return void res.json([]);
        const pagos = await dataSource.query(`${PAYMENT_SELECT} WHERE p.orden_id = $1::uuid ORDER BY p.creado_en`, [req.params.orden_id]);
        res.json(await withRefunds(pagos));
      });

      /** Listado de pagos para la administración (filtros por estado y método). */
      a.get('/pagos', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        const params = [optionalText(req.query.estado), optionalText(req.query.metodo_pago)];
        const where = `($1::varchar IS NULL OR p.estado = $1) AND ($2::varchar IS NULL OR p.metodo_pago = $2)`;
        const { limit, offset } = paging(req.query);
        const [{ total }] = await dataSource.query(`SELECT count(*)::int AS total FROM pago p WHERE ${where}`, params);
        const pagos = await dataSource.query(`${PAYMENT_SELECT} WHERE ${where} ORDER BY p.creado_en DESC, p.id LIMIT $3 OFFSET $4`, [...params, limit, offset]);
        res.json({ total, items: await withRefunds(pagos) });
      });
    },
  });

  /** Agrega los reembolsos de cada pago. Los campos opcionales viajan como texto vacío (el proto no tiene null). */
  async function withRefunds(pagos: Record<string, unknown>[]) {
    const ids = pagos.map((p) => p.pago_id);
    const refunds: Record<string, unknown>[] = ids.length === 0 ? [] : await dataSource.query(
      `SELECT pago_id, codigo, monto, motivo, solicitante, estado, emitido_en FROM reembolso WHERE pago_id = ANY($1::uuid[]) ORDER BY creado_en`,
      [ids],
    );
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : '');
    return pagos.map((p) => ({
      pago_id: p.pago_id, orden_id: p.orden_id, metodo_pago: p.metodo_pago, estado: p.estado, monto: Number(p.monto), moneda: p.moneda,
      reembolsado: Number(p.reembolsado), referencia_pasarela: p.referencia_pasarela ?? '', motivo_rechazo: p.motivo_rechazo ?? '',
      creado_en: iso(p.creado_en), procesado_en: iso(p.procesado_en),
      reembolsos: refunds.filter((r) => r.pago_id === p.pago_id).map((r) => ({
        codigo: r.codigo, monto: Number(r.monto), motivo: r.motivo, solicitante: r.solicitante, estado: r.estado, emitido_en: iso(r.emitido_en),
      })),
    }));
  }

  return { app };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_SELECT = `
  SELECT p.id AS pago_id, p.orden_id, p.metodo_pago, p.estado, p.monto, p.moneda, s.reembolsado, p.referencia_pasarela, p.motivo_rechazo,
         p.creado_en, p.procesado_en
    FROM pago p JOIN v_pago_saldo s ON s.pago_id = p.id`;
