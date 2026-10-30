/** Tipos del contrato `Plan/ms_billing_profile/ms_billing_profile-openapi.yaml`. */
export const ID_TYPES = ['CEDULA', 'RUC', 'PASAPORTE', 'CONSUMIDOR_FINAL'] as const;
export type TipoIdentificacion = (typeof ID_TYPES)[number];

/** Identificación fija del SRI para consumidor final. */
export const FINAL_CONSUMER_ID = '9999999999999';

/** `DatoFacturacionRequest` validado. */
export interface DatoFacturacionInput {
  tipo_identificacion: TipoIdentificacion;
  identificacion: string;
  razon_social: string;
  correo: string;
  telefono: string | null;
  es_principal: boolean;
}

export interface DatoFacturacionDto {
  id: number;
  usu_id: number;
  tipo_identificacion: TipoIdentificacion;
  identificacion: string;
  razon_social: string;
  correo: string;
  telefono: string | null;
  es_principal: boolean;
  activo: boolean;
  creado_en: string;
}
