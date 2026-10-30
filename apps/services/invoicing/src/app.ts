import {
  BUSINESS_TIME_ZONE,
  checkHealth,
  createHttpService,
  createLogger,
  EsbClient,
  requireAdmin,
  type DatabaseSettings,
  type EventBus,
  type Logger,
} from '@atracciones/platform';
import type { Express } from 'express';
import type { DataSource } from 'typeorm';
import type { Emisor } from './application/comprobantes';
import { InvoicingService } from './application/invoicing';

export interface InvoicingConfig {
  port: number;
  database: DatabaseSettings;
  esbUrl: string;
  internalTokenSecret: string;
  emisor: Emisor;
  iva: { codigo: string; porcentaje: number };
  timeZone: string;
  workerIntervalMs: number;
}

/** Datos del emisor: los valores por defecto son los del ejemplo del contrato (ambiente de pruebas). */
export function readInvoicingConfig(env: NodeJS.ProcessEnv = process.env): InvoicingConfig {
  return {
    port: Number(env.PORT ?? 4008),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/invoicing_db', ssl: env.DATABASE_SSL === 'true' },
    esbUrl: env.ESB_URL ?? 'http://127.0.0.1:3300',
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    emisor: {
      ambiente: env.SRI_AMBIENTE === '2' ? '2' : '1',
      ruc: env.SRI_RUC ?? '1792348123001',
      razonSocial: env.SRI_RAZON_SOCIAL ?? 'DESCUBRE EC TOURS & EXPERIENCES',
      nombreComercial: env.SRI_NOMBRE_COMERCIAL ?? 'Descubre EC',
      dirMatriz: env.SRI_DIR_MATRIZ ?? 'Quito, Ecuador',
      dirEstablecimiento: env.SRI_DIR_ESTABLECIMIENTO ?? 'Quito, Ecuador',
      establecimiento: env.SRI_ESTABLECIMIENTO ?? '001',
      puntoEmision: env.SRI_PUNTO_EMISION ?? '001',
      obligadoContabilidad: env.SRI_OBLIGADO_CONTABILIDAD === 'SI' ? 'SI' : 'NO',
    },
    iva: { codigo: env.IVA_CODIGO ?? '4', porcentaje: Number(env.IVA_PORCENTAJE ?? 15) },
    timeZone: env.APP_TIMEZONE ?? BUSINESS_TIME_ZONE,
    workerIntervalMs: Number(env.SRI_WORKER_INTERVAL_MS ?? 5000),
  };
}

export interface InvoicingApp {
  app: Express;
  invoicing: InvoicingService;
  consume(bus: EventBus): Promise<void>;
}

/** Electronic Invoicing Service (SOAP con el SRI a través del ESB, plan §3.8). */
export function createInvoicingService(config: InvoicingConfig, dataSource: DataSource, logger: Logger = createLogger('invoicing')): InvoicingApp {
  const invoicing = new InvoicingService(dataSource, new EsbClient(config.esbUrl, 20_000), {
    emisor: config.emisor, iva: config.iva, timeZone: config.timeZone, internalTokenSecret: config.internalTokenSecret,
  }, logger);
  const app = createHttpService({
    service: 'invoicing',
    logger,
    health: () => checkHealth('invoicing', dataSource),
    routes: (a) => {
      /** Comprobantes de una orden (consulta interna / administración). */
      a.get('/facturas', async (req, res) => {
        await requireAdmin(config.internalTokenSecret);
        const ordenId = typeof req.query.orden_id === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.orden_id) ? req.query.orden_id : null;
        const rows: Record<string, unknown>[] = await dataSource.query(
          `SELECT f.id, f.tipo_comprobante, f.establecimiento || '-' || f.punto_emision || '-' || f.secuencial AS numero, f.clave_acceso, f.estado_sri,
                  coalesce(f.numero_autorizacion, '') AS numero_autorizacion, f.fecha_autorizacion, f.intentos,
                  t.subtotal_sin_iva::float AS subtotal_sin_iva, t.subtotal_con_iva::float AS subtotal_con_iva, t.iva::float AS iva, t.total::float AS total
             FROM factura f JOIN v_factura_totales t ON t.factura_id = f.id
            WHERE ($1::uuid IS NULL OR f.orden_id = $1::uuid) ORDER BY f.creado_en DESC LIMIT 100`,
          [ordenId],
        );
        res.json(rows.map((r) => ({ ...r, fecha_autorizacion: r.fecha_autorizacion ? new Date(r.fecha_autorizacion as string).toISOString() : '' })));
      });
    },
  });
  return {
    app,
    invoicing,
    consume: async (bus) => {
      await bus.subscribe('invoicing.facturas', ['order.OrdenConfirmada'], (e) => invoicing.onOrderConfirmed(e));
      await bus.subscribe('invoicing.notas-credito', ['payment.ReembolsoEmitido'], (e) => invoicing.onRefund(e));
    },
  };
}
