/**
 * Rutas del ESB hacia Payment (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. Los webhooks no pasan por aquí: entran por el API Gateway.
 */
export interface PaymentRestRoute {
  protocol: 'rest';
  target: 'payment';
  method: 'GET' | 'POST';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const PAYMENT_BASE_PATH = '/api/v3';

const route = (method: PaymentRestRoute['method'], path: string, timeoutMs = 3000): PaymentRestRoute => ({
  protocol: 'rest', target: 'payment', method, path: `${PAYMENT_BASE_PATH}${path}`, timeoutMs,
});

export const MS_PAYMENT_ROUTES = {
  'payment.health': route('GET', '/health', 1000),
  'payment.listMethods': route('GET', '/metodos-pago'),

  // Uso interno (`X-Service-Token`): Order y Refund.
  'payment.createPayment': route('POST', '/pagos'),
  'payment.cancelPayment': route('POST', '/pagos/:id/cancelacion'),
  'payment.listOrderPayments': route('GET', '/pagos/orden/:ordId'),
  'payment.getPayment': route('GET', '/pagos/:id'),

  // Portal y administración.
  'payment.listPayments': route('GET', '/pagos'),
  'payment.submitTransfer': route('POST', '/pagos/:id/transferencia', 5000),
} as const satisfies Record<string, PaymentRestRoute>;

export type PaymentRouteKey = keyof typeof MS_PAYMENT_ROUTES;

/** Nombre de la operación para `EsbClient.call('payment', operación)` (`payment.getPayment` → `getPayment`). */
export type PaymentOperation = PaymentRouteKey extends `payment.${infer O}` ? O : never;
