/** Tipos del contrato `Plan/ms_refund/ms_refund-openapi.yaml`, compartidos por el servicio y por `RefundClient`. */
import type { SOLICITANTES_CANCELACION } from '@atracciones/platform';

export type RefundStatus = 'PENDIENTE' | 'EMITIDO' | 'FALLIDO';
export type Solicitante = (typeof SOLICITANTES_CANCELACION)[number];

/** `RefundRequest`: misma entrada que la ruta `POST /reembolsos` que tenía Payment. */
export interface RefundRequestDto {
  clave_pago: string;
  clave_idempotencia: string;
  monto?: number;
  motivo?: string;
  solicitante: Solicitante;
}

/** `RefundResult`: misma salida que tenía Payment. `SIN_COBRO` / `SIN_SALDO` no son errores para la saga. */
export interface RefundResultDto {
  reembolso_codigo: string | null;
  monto: number;
  estado: RefundStatus | 'SIN_COBRO' | 'SIN_SALDO';
}

/** `Refund`. */
export interface RefundDto {
  codigo: string;
  pago_id: string;
  orden_id: string;
  monto: number;
  moneda: string;
  motivo: string;
  solicitante: Solicitante;
  estado: RefundStatus;
  referencia: string | null;
  solicitado_en: string;
  emitido_en: string | null;
}

/** Elemento de `POST /reembolsos/pagos`. */
export interface PaymentRefundsDto {
  pago_id: string;
  /** Suma de los reembolsos `EMITIDO`. */
  reembolsado: number;
  reembolsos: RefundDto[];
}

/** Payload de `refund.ReembolsoEmitido` (el mismo que publicaba Payment; lo consume Invoicing). */
export interface ReembolsoEmitidoPayload {
  reembolso_codigo: string;
  pago_id: string;
  orden_id: string;
  monto: number;
}

/** `GET /health` (ServiceHealth de la plataforma). */
export interface RefundHealthDto {
  status: 'UP' | 'DOWN';
  service: string;
  database_connected: boolean | null;
  latency_ms: number;
  memory_usage_mb: number;
  uptime_seconds: number;
  timestamp: string;
}
