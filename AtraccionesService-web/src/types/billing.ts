import type { IsoDateTime } from './api';

/** Perfiles de facturación de ms-billing-profile: un usuario puede tener varios, uno principal. */

export type IdentificationType = 'CEDULA' | 'RUC' | 'PASAPORTE' | 'CONSUMIDOR_FINAL';

export interface BillingProfileInput {
  tipo_identificacion: IdentificationType;
  identificacion: string;
  razon_social: string;
  correo: string;
  telefono: string | null;
  es_principal: boolean;
}

export interface BillingProfile extends BillingProfileInput {
  id: number;
  activo: boolean;
  creado_en: IsoDateTime;
}
