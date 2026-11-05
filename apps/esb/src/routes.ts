/**
 * Tabla de rutas del ESB: `servicio.operación` → protocolo y destino. El ESB no tiene lógica de negocio: solo traduce la
 * entrada JSON al protocolo del servicio y devuelve su respuesta.
 *
 * Cada microservicio publica sus rutas en `src/integration/esb-routes.ts` (`MS_*_ROUTES`) y aquí solo se juntan.
 * REST: los `:parametros` de la ruta se toman de la entrada; el resto va en la query (GET/DELETE) o en el cuerpo.
 * Booking, Order, Inventory y Pricing usan `POST /internal/rpc/<Método>`, con el mensaje del `.proto` como cuerpo.
 */
import { MS_AUDIT_ROUTES } from '@atracciones/ms-audit-service/dist/integration/esb-routes';
import { MS_BILLING_ROUTES } from '@atracciones/ms-billing-profile-service/dist/integration/esb-routes';
import { MS_BOOKING_ROUTES } from '@atracciones/ms-booking-service/dist/integration/esb-routes';
import { MS_CART_ROUTES } from '@atracciones/ms-cart-service/dist/integration/esb-routes';
import { MS_CATALOG_ROUTES } from '@atracciones/ms-catalog-service/dist/integration/esb-routes';
import { MS_COUPON_ROUTES } from '@atracciones/ms-coupon-service/dist/integration/esb-routes';
import { MS_IDENTITY_ROUTES } from '@atracciones/ms-identity-service/dist/integration/esb-routes';
import { MS_INVENTORY_ROUTES } from '@atracciones/ms-inventory-service/dist/integration/esb-routes';
import { MS_INVOICING_ROUTES } from '@atracciones/ms-invoicing-service/dist/integration/esb-routes';
import { MS_LOCATION_ROUTES } from '@atracciones/ms-location-service/dist/integration/esb-routes';
import { MS_ORDER_ROUTES } from '@atracciones/ms-order-service/dist/integration/esb-routes';
import { MS_PAYMENT_ROUTES } from '@atracciones/ms-payment-service/dist/integration/esb-routes';
import { MS_PRICING_ROUTES } from '@atracciones/ms-pricing-service/dist/integration/esb-routes';
import { MS_REFUND_ROUTES } from '@atracciones/ms-refund-service/dist/integration/esb-routes';
import { MS_REVIEW_ROUTES } from '@atracciones/ms-review-service/dist/integration/esb-routes';
import { MS_SUPPORT_ROUTES } from '@atracciones/ms-support-service/dist/integration/esb-routes';

export interface RestRoute {
  protocol: 'rest';
  target: TargetName;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  timeoutMs?: number;
  /**
   * Credencial de la llamada. `service-token` (por defecto) para los servicios internos. `partner-api-key` para un
   * sistema externo: se envía su `X-API-Key` y no se reenvían el `X-Service-Token` ni el principal interno.
   */
  auth?: 'service-token' | 'partner-api-key';
}

/** SOAP 1.1: la entrada son los parámetros de la operación; la salida, el contenido de `<operacionResponse>`. */
export interface SoapRoute {
  protocol: 'soap';
  target: TargetName;
  namespace: string;
  operation: string;
  timeoutMs?: number;
  /** El SRI real no conoce la cabecera de correlación: se puede omitir. */
  correlationHeader?: boolean;
}

export type Route = RestRoute | SoapRoute;

/** Destinos: URL base para REST y URL del endpoint para SOAP. */
export type TargetName =
  | 'identity' | 'location' | 'catalog' | 'billing' | 'pricing' | 'inventory' | 'review' | 'coupon' | 'cart' | 'payment'
  | 'order' | 'booking' | 'refund' | 'invoicing' | 'support' | 'audit' | 'sri_recepcion' | 'sri_autorizacion' | 'booking_core';

export const ROUTES: Record<string, Route> = {
  ...MS_IDENTITY_ROUTES,
  ...MS_LOCATION_ROUTES,
  ...MS_CATALOG_ROUTES,
  ...MS_BILLING_ROUTES,
  ...MS_PRICING_ROUTES,
  ...MS_INVENTORY_ROUTES,
  ...MS_REVIEW_ROUTES,
  ...MS_COUPON_ROUTES,
  ...MS_CART_ROUTES,
  ...MS_PAYMENT_ROUTES,
  ...MS_ORDER_ROUTES,
  ...MS_BOOKING_ROUTES,
  ...MS_REFUND_ROUTES,
  ...MS_INVOICING_ROUTES,
  ...MS_SUPPORT_ROUTES,
  ...MS_AUDIT_ROUTES,

  // Booking Central (externo): Booking lo llama después del check-in presencial para cerrar la asistencia en su plataforma.
  'bookingCore.notifyCheckin': {
    protocol: 'rest', target: 'booking_core', method: 'POST', path: '/api/v3/reservas/:external_order_id/checkin', auth: 'partner-api-key', timeoutMs: 8000,
  },

  // SRI del Ecuador (SOAP, comprobantes electrónicos offline): Invoicing los llama a través del ESB.
  'sri.validarComprobante': { protocol: 'soap', target: 'sri_recepcion', namespace: 'http://ec.gob.sri.ws.recepcion', operation: 'validarComprobante', timeoutMs: 15_000 },
  'sri.autorizacionComprobante': { protocol: 'soap', target: 'sri_autorizacion', namespace: 'http://ec.gob.sri.ws.autorizacion', operation: 'autorizacionComprobante', timeoutMs: 15_000 },
};
