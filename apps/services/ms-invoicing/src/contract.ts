/** Tipos del contrato `Plan/ms_invoicing/ms_invoicing-openapi.yaml`. */
export const INVOICE_STATES = ['NO_PAGADA', 'PAGADA', 'ANULADA'] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

export const SRI_STATES = ['PENDIENTE', 'AUTORIZADA', 'RECHAZADA'] as const;
export type SriState = (typeof SRI_STATES)[number];

export type IdType = 'CEDULA' | 'RUC' | 'PASAPORTE' | 'CONSUMIDOR_FINAL';

export interface FacturaDto {
  id: number;
  ord_id: number;
  dfa_id: number | null;
  numero: string;
  clave_acceso: string | null;
  autorizacion_sri: string | null;
  estado: InvoiceState;
  estado_sri: SriState;
  mensaje_sri: string | null;
  emitida_en: string;
  subtotal: number;
  descuento: number;
  iva: number;
  total: number;
  tipo_identificacion: IdType;
  identificacion: string;
  razon_social: string;
  correo: string;
  telefono: string | null;
}

export interface FacturaLinea {
  det_id: number;
  codigo: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento: number;
  subtotal: number;
  iva_porcentaje: number;
  iva: number;
  total: number;
}

export interface FacturaDetalle extends FacturaDto {
  detalle: FacturaLinea[];
}

export interface FacturaPage {
  metadata: { total_results: number; page: number; limit: number; total_pages: number };
  data: FacturaDto[];
}

/** Comprador en el momento de emitir: una copia, para que cambiar el perfil no altere la factura. */
export interface Buyer {
  dfaId: number | null;
  tipo: IdType;
  identificacion: string;
  razonSocial: string;
  correo: string;
  telefono: string | null;
}

/** Datos de la tienda en `infoTributaria`. */
export interface Issuer {
  ambiente: '1' | '2';
  ruc: string;
  razonSocial: string;
  direccion: string;
}
