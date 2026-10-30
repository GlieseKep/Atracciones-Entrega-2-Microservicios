/** Tipos del contrato `Plan/ms_billing_profile/ms_billing_profile-openapi.yaml`, compartidos por el servicio y por `BillingProfileClient`. */

export const TIPOS_IDENTIFICACION = ['CEDULA', 'RUC', 'PASAPORTE', 'CONSUMIDOR_FINAL'] as const;
export type TipoIdentificacion = (typeof TIPOS_IDENTIFICACION)[number];

/** Identificación fija de `CONSUMIDOR_FINAL` (SRI). */
export const CONSUMIDOR_FINAL_ID = '9999999999999';

/** `BillingProfileRequest`. */
export interface BillingProfileRequestDto {
  tipo_identificacion: TipoIdentificacion;
  identificacion: string;
  razon_social: string;
  correo: string;
  telefono?: string | null;
  direccion?: string | null;
  es_principal?: boolean;
}

/** `BillingProfile`. */
export interface BillingProfileDto {
  id: number;
  tipo_identificacion: TipoIdentificacion;
  identificacion: string;
  razon_social: string;
  correo: string;
  telefono: string | null;
  direccion: string | null;
  es_principal: boolean;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
}

/** `LegacyBillingRequest`: forma de `PUT /usuarios/me/facturacion` en Identity. */
export interface LegacyBillingRequestDto {
  tipo_documento: 'CEDULA' | 'PASAPORTE' | 'RUC';
  numero_documento: string;
  razon_social: string;
  email: string;
  telefono?: string | null;
  direccion?: string | null;
}

/** `LegacyBilling`. `tipo_documento` puede ser `CONSUMIDOR_FINAL` si el principal se creó con la API nueva. */
export interface LegacyBillingDto {
  tipo_documento: TipoIdentificacion;
  numero_documento: string;
  razon_social: string;
  email: string;
  telefono: string | null;
  direccion: string | null;
  actualizado_en: string;
}

/** `GET /health` (ServiceHealth de la plataforma). */
export interface BillingProfileHealthDto {
  status: 'UP' | 'DOWN';
  service: string;
  database_connected: boolean | null;
  latency_ms: number;
  memory_usage_mb: number;
  uptime_seconds: number;
  timestamp: string;
}
