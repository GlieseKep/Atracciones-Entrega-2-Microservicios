/** Tipos del contrato `Plan/ms_support/ms_support-openapi.yaml`, compartidos por el servicio y por `SupportClient`. */

/** Flujo de seguimiento (los mismos estados que tenía Audit). */
export const ESTADOS_MENSAJE = ['NUEVO', 'EN_PROCESO', 'RESPONDIDO', 'CERRADO'] as const;
export type MessageStatus = (typeof ESTADOS_MENSAJE)[number];

/** `ContactMessageRequest`. */
export interface ContactMessageRequestDto {
  nombre: string;
  email: string;
  asunto: string;
  mensaje: string;
}

/** `ContactMessage`: mismos campos que la respuesta de Audit (el `id` ahora es numérico, como texto). */
export interface ContactMessageDto {
  id: string;
  usuario_id: string | null;
  nombre: string;
  email: string;
  asunto: string;
  mensaje: string;
  estado: MessageStatus;
  correlation_id: string;
  creado_en: string;
  respondido_en: string | null;
}

/** Página de `GET /mensajes-contacto` (misma forma `{ total, items }` que Audit). */
export interface ContactMessagePageDto {
  total: number;
  items: ContactMessageDto[];
}

/** `GET /mensajes-contacto/resumen`. */
export type ContactSummaryDto = Record<MessageStatus, number>;

/** `GET /health` (ServiceHealth de la plataforma). */
export interface SupportHealthDto {
  status: 'UP' | 'DOWN';
  service: string;
  database_connected: boolean | null;
  latency_ms: number;
  memory_usage_mb: number;
  uptime_seconds: number;
  timestamp: string;
}
