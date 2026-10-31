/** Tipos del contrato `Plan/ms_payment/ms_payment-openapi.yaml`. */
export const METHODS = ['CREDIT_CARD', 'DEBIT_CARD', 'PAYPAL', 'TRANSFER'] as const;
export type MetodoCodigo = (typeof METHODS)[number];

export const STATES = ['PENDIENTE', 'APROBADO', 'RECHAZADO', 'FALLIDO'] as const;
export type EstadoPago = (typeof STATES)[number];

export interface MetodoPagoDto {
  id: number;
  codigo: MetodoCodigo;
  nombre: string;
  requiere_datos: boolean;
}

export interface TarjetaInput {
  marca: string;
  ultimos4: string;
  titular: string;
  mes: number;
  anio: number;
  pais: string;
}

export interface PagoInput {
  numero: string;
  ord_id: number;
  metodo: MetodoCodigo;
  monto: number;
  moneda: string;
  canal: 'WEB' | 'B2B';
  tarjeta: TarjetaInput | null;
}

export interface TransferenciaInput {
  banco: string;
  numero_comprobante: string;
  fecha_transferencia: string;
  archivo_adjunto: string | null;
}

export interface PagoDto {
  id: number;
  numero: string;
  ord_id: number;
  metodo: MetodoCodigo;
  estado: EstadoPago;
  monto: number;
  referencia: string | null;
  autorizacion: string | null;
  motivo_rechazo: string | null;
  fecha: string;
  aprobado_en: string | null;
  rechazado_en: string | null;
}

export interface PagoPage {
  metadata: { total_results: number; page: number; limit: number; total_pages: number };
  data: PagoDto[];
}

/** Resultado del cobro: siempre lo informa la pasarela. */
export type PaymentResult =
  | { aprobado: true; referencia: string | null; autorizacion: string | null }
  | { aprobado: false; motivo: string };

/** Cuerpo del webhook de la pasarela simulada. */
export interface WebhookResult {
  numero: string;
  resultado: 'APROBADO' | 'RECHAZADO';
  referencia?: string | null;
  autorizacion?: string | null;
  motivo?: string | null;
}
