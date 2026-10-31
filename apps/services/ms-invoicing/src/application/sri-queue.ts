import { AppError, errorFields, type EsbClient, type Logger } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { FacturaDetalle, Issuer } from '../contract';
import type { InvoiceRepository, PendingInvoice } from '../persistence/invoice-repository';
import { invoiceXml } from './invoice-xml';

const MAX_ATTEMPTS = 5;
/** Código con que el SRI devuelve un comprobante ya recibido: pasa cuando se reintenta tras una caída. */
const ALREADY_RECEIVED = '43';

interface Message {
  identificador?: string;
  mensaje?: string;
}

interface Reception {
  RespuestaRecepcionComprobante?: { estado?: string; comprobantes?: { comprobante?: { mensajes?: { mensaje?: Message | Message[] } } } };
}

interface Authorization {
  RespuestaAutorizacionComprobante?: {
    autorizaciones?: { autorizacion?: { estado?: string; numeroAutorizacion?: string; mensajes?: { mensaje?: Message | Message[] } } };
  };
}

const list = (value: Message | Message[] | undefined) => (Array.isArray(value) ? value : value ? [value] : []);
const describe = (messages: Message[]) => messages.map((item) => `${item.identificador ?? ''} ${item.mensaje ?? ''}`.trim()).join('; ') || 'El SRI rechazó el comprobante.';

/** Rechazo del propio SRI: reintentar no lo arregla. */
class SriRejection extends Error {}

/**
 * Envía las facturas al SRI a ritmo controlado, una a la vez. La compra nunca espera por esto. Un error técnico se reintenta
 * a los 1, 2, 4 y 8 minutos; al quinto fallo, o con un rechazo del SRI, queda `RECHAZADA` para que un `ADMIN` la revise.
 */
export class SriQueue {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly invoices: InvoiceRepository,
    private readonly esb: EsbClient,
    private readonly issuer: Issuer,
    private readonly maxPerMinute: number,
    private readonly logger: Logger,
  ) {}

  private async receive(factura: FacturaDetalle): Promise<void> {
    const xml = Buffer.from(invoiceXml(factura, this.issuer), 'utf8').toString('base64');
    const response = await this.esb.call<Reception>('sri', 'validarComprobante', { xml });
    const reception = response.RespuestaRecepcionComprobante;
    if (reception?.estado === 'RECIBIDA') return;
    const messages = list(reception?.comprobantes?.comprobante?.mensajes?.mensaje);
    if (messages.some((item) => item.identificador === ALREADY_RECEIVED)) return;
    throw new SriRejection(describe(messages));
  }

  private async authorize(factura: FacturaDetalle): Promise<string> {
    const response = await this.esb.call<Authorization>('sri', 'autorizacionComprobante', { claveAccesoComprobante: factura.clave_acceso });
    const authorization = response.RespuestaAutorizacionComprobante?.autorizaciones?.autorizacion;
    if (authorization?.estado === 'AUTORIZADO' && authorization.numeroAutorizacion) return authorization.numeroAutorizacion;
    if (authorization) throw new SriRejection(describe(list(authorization.mensajes?.mensaje)));
    throw new AppError(503, 'SRI_PENDING', 'El SRI todavía no autoriza el comprobante.');
  }

  private async send({ factura, intentos }: PendingInvoice, m: EntityManager): Promise<void> {
    try {
      await this.receive(factura);
      await this.invoices.markAuthorized(factura, await this.authorize(factura), m);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      const attempt = intentos + 1;
      if (error instanceof SriRejection || attempt >= MAX_ATTEMPTS) {
        await this.invoices.markRejected(factura.id, mensaje, m);
        this.logger.error('factura rechazada por el SRI', { fac_id: factura.id, numero: factura.numero, mensaje });
        return;
      }
      await this.invoices.scheduleRetry(factura.id, attempt, 2 ** (attempt - 1), mensaje, m);
      this.logger.warn('el SRI no respondió; se reintentará', { fac_id: factura.id, attempt, ...errorFields(error) });
    }
  }

  private processNext(): Promise<void> {
    return this.dataSource.transaction(async (m) => {
      const next = await this.invoices.takeNext(m);
      if (next) await this.send(next, m);
    });
  }

  private tick(): void {
    if (this.running) return;
    this.running = this.processNext()
      .catch((error: unknown) => this.logger.error('falló la cola del SRI', errorFields(error)))
      .finally(() => {
        this.running = null;
      });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), Math.ceil(60_000 / this.maxPerMinute));
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
