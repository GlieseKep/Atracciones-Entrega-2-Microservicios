import { randomInt } from 'node:crypto';
import {
  AppError,
  claveAcceso,
  errorFields,
  recordEvent,
  runWithContext,
  servicePrincipal,
  signInternalPrincipal,
  todayIn,
  type EsbClient,
  type EventEnvelope,
  type Logger,
} from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { facturaXml, notaCreditoXml, type Comprador, type Emisor, type Linea } from './comprobantes';

export interface InvoicingSettings {
  emisor: Emisor;
  /** Tarifa de IVA aplicada a los boletos (los precios del catálogo incluyen IVA). */
  iva: { codigo: string; porcentaje: number };
  timeZone: string;
  internalTokenSecret: string;
}

interface OrderLine {
  atraccion_codigo: string;
  fecha: string;
  hora: string;
  tipo_boleto: string;
  cantidad: number;
  precio_unitario: number;
}

const TIPO_IDENTIFICACION: Record<string, string> = { RUC: '04', CEDULA: '05', PASAPORTE: '06' };
const FORMA_PAGO: Record<string, string> = { TARJETA_CREDITO: '19', TRANSFERENCIA: '20', SOA_BOOKING_GATEWAY: '20', PAGO_EN_SITIO: '01' };

/**
 * Facturación electrónica (plan §3.8). Genera el comprobante al confirmarse una orden y la nota de crédito al emitirse un
 * reembolso; un worker los envía al SRI por SOAP (a través del ESB) con reintento exponencial (D9). Nada de esto está en
 * el camino síncrono de la compra.
 */
export class InvoicingService {
  constructor(
    private readonly db: DataSource,
    private readonly esb: EsbClient,
    private readonly settings: InvoicingSettings,
    private readonly logger: Logger,
  ) {}

  /** Llama al ESB con la cuenta de servicio de Invoicing (para leer el comprador de una reserva). */
  private async asService<T>(correlationId: string, work: () => Promise<T>): Promise<T> {
    const principalToken = await signInternalPrincipal(servicePrincipal('invoicing'), this.settings.internalTokenSecret);
    return runWithContext({ correlationId, principalToken }, work);
  }

  private async comprador(externalOrderId: string, correlationId: string): Promise<Comprador> {
    const reserva = await this.asService(correlationId, () =>
      this.esb.call<{ customer: { full_name: string; email: string; document_type: string; document_id: string } }>('booking', 'getReservation', { id: externalOrderId }),
    );
    const c = reserva.customer;
    return { tipoIdentificacion: TIPO_IDENTIFICACION[c.document_type] ?? '06', identificacion: c.document_id, razonSocial: c.full_name, email: c.email, direccion: null };
  }

  /** Línea de factura: precio unitario sin IVA (el del catálogo lo incluye). */
  private linea(l: OrderLine): Linea {
    const factor = 1 + this.settings.iva.porcentaje / 100;
    return {
      codigoPrincipal: `${l.atraccion_codigo.trim()}-${l.tipo_boleto}`,
      descripcion: `Boleto ${l.tipo_boleto} ${l.atraccion_codigo.trim()} ${l.fecha} ${l.hora.slice(0, 5)}`,
      cantidad: l.cantidad,
      precioUnitario: Math.round((l.precio_unitario / factor) * 1_000_000) / 1_000_000,
      descuento: 0,
      codigoTarifaIva: this.settings.iva.codigo,
      porcentajeIva: this.settings.iva.porcentaje,
    };
  }

  /** Siguiente secuencial de la serie (bloqueo por serie para que dos facturas no compartan número). */
  private async nextNumber(m: EntityManager, tipo: 'FACTURA' | 'NOTA_CREDITO') {
    const e = this.settings.emisor;
    await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${tipo}-${e.establecimiento}-${e.puntoEmision}`]);
    const [{ siguiente }] = await m.query(
      `SELECT coalesce(max(secuencial::int), 0) + 1 AS siguiente FROM factura WHERE tipo_comprobante = $1 AND establecimiento = $2 AND punto_emision = $3`,
      [tipo, e.establecimiento, e.puntoEmision],
    );
    const secuencial = String(siguiente).padStart(9, '0');
    const fecha = todayIn(this.settings.timeZone);
    const clave = claveAcceso({
      fecha, tipoComprobante: tipo === 'FACTURA' ? '01' : '04', ruc: e.ruc, ambiente: e.ambiente, establecimiento: e.establecimiento,
      puntoEmision: e.puntoEmision, secuencial, codigoNumerico: String(randomInt(0, 100_000_000)).padStart(8, '0'),
    });
    return { secuencial, fecha, clave };
  }

  private async insertFactura(m: EntityManager, data: {
    ordenId: string; tipo: 'FACTURA' | 'NOTA_CREDITO'; origenId: string | null; numero: { secuencial: string; clave: string }; comprador: Comprador; lineas: Linea[]; xml: string; correlationId: string;
  }): Promise<void> {
    const e = this.settings.emisor;
    const [factura] = await m.query(
      `INSERT INTO factura (orden_id, tipo_comprobante, factura_origen_id, establecimiento, punto_emision, secuencial, clave_acceso, ambiente,
                            comprador_tipo_identificacion, comprador_identificacion, comprador_razon_social, comprador_email, comprador_direccion,
                            xml_firmado, correlation_id, proximo_intento_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
       ON CONFLICT ON CONSTRAINT uq_factura_orden DO NOTHING RETURNING id`,
      [data.ordenId, data.tipo, data.origenId, e.establecimiento, e.puntoEmision, data.numero.secuencial, data.numero.clave, e.ambiente === '1' ? 'PRUEBAS' : 'PRODUCCION',
        data.comprador.tipoIdentificacion, data.comprador.identificacion, data.comprador.razonSocial, data.comprador.email, data.comprador.direccion,
        data.xml, data.correlationId],
    );
    if (!factura) return; // ya existía (evento reentregado)
    for (const l of data.lineas) {
      await m.query(
        `INSERT INTO factura_detalle (factura_id, codigo_principal, descripcion, cantidad, precio_unitario, descuento, codigo_tarifa_iva) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [factura.id, l.codigoPrincipal.slice(0, 25), l.descripcion.slice(0, 300), l.cantidad, l.precioUnitario, l.descuento, l.codigoTarifaIva],
      );
    }
  }

  /** `OrdenConfirmada` → factura pendiente de envío al SRI. Idempotente por orden. */
  async onOrderConfirmed(event: EventEnvelope): Promise<void> {
    const data = event.data as { orden_id: string; external_order_id: string; metodo_pago: string; lineas: OrderLine[] };
    const [existing] = await this.db.query(`SELECT 1 FROM factura WHERE orden_id = $1 AND tipo_comprobante = 'FACTURA'`, [data.orden_id]);
    if (existing) return;
    const comprador = await this.comprador(data.external_order_id, event.correlation_id);
    const lineas = (data.lineas ?? []).map((l) => this.linea(l));
    await this.db.transaction(async (m) => {
      const numero = await this.nextNumber(m, 'FACTURA');
      const xml = facturaXml(this.settings.emisor, comprador, lineas, numero.fecha, numero.clave, numero.secuencial, FORMA_PAGO[data.metodo_pago] ?? '20');
      await this.insertFactura(m, { ordenId: data.orden_id, tipo: 'FACTURA', origenId: null, numero, comprador, lineas, xml, correlationId: event.correlation_id });
    });
  }

  /** `ReembolsoEmitido` → nota de crédito sobre la factura de la orden (si la factura todavía no existe, el bus reintenta). */
  async onRefund(event: EventEnvelope): Promise<void> {
    const data = event.data as { orden_id: string; monto: number; reembolso_codigo: string };
    const [factura] = await this.db.query(
      `SELECT id, establecimiento, punto_emision, secuencial, creado_en, comprador_tipo_identificacion, comprador_identificacion, comprador_razon_social, comprador_email
         FROM factura WHERE orden_id = $1 AND tipo_comprobante = 'FACTURA'`,
      [data.orden_id],
    );
    if (!factura) throw AppError.unavailable(`La factura de la orden ${data.orden_id} todavía no existe.`);
    const factor = 1 + this.settings.iva.porcentaje / 100;
    const lineas: Linea[] = [{
      codigoPrincipal: data.reembolso_codigo, descripcion: `Devolución ${data.reembolso_codigo}`, cantidad: 1,
      precioUnitario: Math.round((data.monto / factor) * 1_000_000) / 1_000_000, descuento: 0, codigoTarifaIva: this.settings.iva.codigo, porcentajeIva: this.settings.iva.porcentaje,
    }];
    const comprador: Comprador = { tipoIdentificacion: factura.comprador_tipo_identificacion, identificacion: factura.comprador_identificacion, razonSocial: factura.comprador_razon_social, email: factura.comprador_email, direccion: null };
    await this.db.transaction(async (m) => {
      const numero = await this.nextNumber(m, 'NOTA_CREDITO');
      const xml = notaCreditoXml(this.settings.emisor, comprador, lineas, numero.fecha, numero.clave, numero.secuencial, {
        numero: `${factura.establecimiento}-${factura.punto_emision}-${factura.secuencial}`,
        fecha: new Date(factura.creado_en).toISOString().slice(0, 10),
        motivo: `Cancelación de la reserva (reembolso ${data.reembolso_codigo})`,
      });
      await this.insertFactura(m, { ordenId: data.orden_id, tipo: 'NOTA_CREDITO', origenId: factura.id, numero, comprador, lineas, xml, correlationId: event.correlation_id });
    });
  }

  /**
   * Worker: envía al SRI los comprobantes pendientes y consulta la autorización de los recibidos, a un ritmo controlado
   * (lote pequeño) y con reintento exponencial ante fallas (plan D9).
   */
  async processQueue(batch = 10): Promise<number> {
    const pendientes: { id: string; estado_sri: string; clave_acceso: string; xml_firmado: string; intentos: number; correlation_id: string; orden_id: string; tipo_comprobante: string }[] = await this.db.query(
      `SELECT id, estado_sri, clave_acceso, xml_firmado, intentos, correlation_id, orden_id, tipo_comprobante FROM factura
        WHERE estado_sri IN ('PENDIENTE', 'RECIBIDA') AND (proximo_intento_en IS NULL OR proximo_intento_en <= now())
        ORDER BY creado_en LIMIT $1`,
      [batch],
    );
    let processed = 0;
    for (const f of pendientes) {
      try {
        await runWithContext({ correlationId: f.correlation_id }, () => (f.estado_sri === 'PENDIENTE' ? this.send(f) : this.authorize(f)));
        processed++;
      } catch (error) {
        const intentos = f.intentos + 1;
        await this.db.query(
          `UPDATE factura SET intentos = $2, proximo_intento_en = now() + make_interval(secs => $3) WHERE id = $1`,
          [f.id, intentos, Math.min(3600, 10 * 2 ** intentos)],
        );
        this.logger.warn('el SRI no respondió; se reintentará', { factura: f.id, intentos, ...errorFields(error) });
      }
    }
    return processed;
  }

  private async saveMessages(m: EntityManager | DataSource, facturaId: string, mensajes: unknown): Promise<void> {
    const list = Array.isArray(mensajes) ? mensajes : mensajes ? [mensajes] : [];
    for (const msg of list as { identificador?: string; mensaje?: string; tipo?: string; informacionAdicional?: string }[]) {
      await m.query(
        `INSERT INTO factura_mensaje_sri (factura_id, identificador, tipo, mensaje, informacion_adicional) VALUES ($1, $2, $3, $4, $5)`,
        [facturaId, String(msg.identificador ?? '').slice(0, 10), ['ERROR', 'ADVERTENCIA', 'INFORMATIVO'].includes(String(msg.tipo)) ? msg.tipo : 'INFORMATIVO', String(msg.mensaje ?? '').slice(0, 500), msg.informacionAdicional ?? null],
      );
    }
  }

  /** Recepción: `validarComprobante`. RECIBIDA → se consultará la autorización; DEVUELTA → requiere corrección manual. */
  private async send(f: { id: string; clave_acceso: string; xml_firmado: string }): Promise<void> {
    const r = await this.esb.call<{ RespuestaRecepcionComprobante: { estado: string; comprobantes?: { comprobante?: { mensajes?: { mensaje?: unknown } } } } }>(
      'sri', 'validarComprobante', { xml: Buffer.from(f.xml_firmado, 'utf8').toString('base64') },
    );
    const respuesta = r.RespuestaRecepcionComprobante;
    const mensajes = respuesta.comprobantes?.comprobante?.mensajes?.mensaje;
    const yaRegistrada = JSON.stringify(mensajes ?? '').includes('"identificador":"43"');
    if (respuesta.estado === 'RECIBIDA' || yaRegistrada) {
      await this.db.query(`UPDATE factura SET estado_sri = 'RECIBIDA', intentos = 0, proximo_intento_en = now() WHERE id = $1`, [f.id]);
      return;
    }
    await this.db.transaction(async (m) => {
      await m.query(`UPDATE factura SET estado_sri = 'DEVUELTA', proximo_intento_en = NULL WHERE id = $1`, [f.id]);
      await this.saveMessages(m, f.id, mensajes);
    });
    this.logger.warn('el SRI devolvió el comprobante', { factura: f.id, clave_acceso: f.clave_acceso });
  }

  /** Autorización: `autorizacionComprobante`. Sin respuesta todavía → se vuelve a consultar más tarde. */
  private async authorize(f: { id: string; clave_acceso: string; intentos: number; orden_id: string; tipo_comprobante: string }): Promise<void> {
    const r = await this.esb.call<{ RespuestaAutorizacionComprobante: { numeroComprobantes: string; autorizaciones?: { autorizacion?: { estado: string; numeroAutorizacion: string; fechaAutorizacion: string; mensajes?: { mensaje?: unknown } } } } }>(
      'sri', 'autorizacionComprobante', { claveAccesoComprobante: f.clave_acceso },
    );
    const autorizacion = r.RespuestaAutorizacionComprobante.autorizaciones?.autorizacion;
    if (!autorizacion) {
      await this.db.query(`UPDATE factura SET intentos = intentos + 1, proximo_intento_en = now() + make_interval(secs => $2) WHERE id = $1`, [f.id, Math.min(3600, 10 * 2 ** (f.intentos + 1))]);
      return;
    }
    await this.db.transaction(async (m) => {
      if (autorizacion.estado === 'AUTORIZADO') {
        await m.query(
          `UPDATE factura SET estado_sri = 'AUTORIZADA', numero_autorizacion = $2, fecha_autorizacion = $3, proximo_intento_en = NULL WHERE id = $1`,
          [f.id, autorizacion.numeroAutorizacion, autorizacion.fechaAutorizacion],
        );
        await recordEvent(m, {
          tipoEvento: 'FacturaAutorizada', agregadoId: f.clave_acceso,
          payload: { factura_id: f.id, orden_id: f.orden_id, tipo_comprobante: f.tipo_comprobante, numero_autorizacion: autorizacion.numeroAutorizacion },
        });
      } else {
        await m.query(`UPDATE factura SET estado_sri = 'NO_AUTORIZADA', proximo_intento_en = NULL WHERE id = $1`, [f.id]);
        await this.saveMessages(m, f.id, autorizacion.mensajes?.mensaje);
      }
    });
  }
}
