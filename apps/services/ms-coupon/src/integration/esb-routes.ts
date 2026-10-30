/**
 * Rutas del ESB hacia Coupon (`servicio.operación` → método y ruta REST), con la misma forma que `RestRoute` de
 * `apps/esb/src/routes.ts`. El ESB toma los `:parametros` de la entrada y manda el resto en la query (GET) o en el cuerpo.
 */
export interface CouponRestRoute {
  protocol: 'rest';
  target: 'coupon';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  timeoutMs: number;
}

/** Prefijo de las rutas del contrato (`servers[0].url`). */
export const COUPON_BASE_PATH = '/api/v3';

const route = (method: CouponRestRoute['method'], path: string, timeoutMs = 3000): CouponRestRoute => ({
  protocol: 'rest', target: 'coupon', method, path: `${COUPON_BASE_PATH}${path}`, timeoutMs,
});

export const MS_COUPON_ROUTES = {
  'coupon.health': route('GET', '/health', 1000),

  // Acuerdo B2B (contrato v3).
  'coupon.getAgreement': route('GET', '/atracciones/promociones/contrato'),
  'coupon.updateAgreement': route('PUT', '/atracciones/promociones/contrato', 5000),

  // Validación: GraphQL y Order.
  'coupon.validateCoupon': route('POST', '/cupones/validacion'),

  // Administración (rol ADMIN).
  'coupon.listCoupons': route('GET', '/cupones'),
  'coupon.createCoupon': route('POST', '/cupones'),
  'coupon.getCoupon': route('GET', '/cupones/:code'),
  'coupon.updateCoupon': route('PATCH', '/cupones/:code'),
} as const satisfies Record<string, CouponRestRoute>;

export type CouponRouteKey = keyof typeof MS_COUPON_ROUTES;

/** Nombre de la operación para `EsbClient.call('coupon', operación)` (`coupon.getCoupon` → `getCoupon`). */
export type CouponOperation = CouponRouteKey extends `coupon.${infer O}` ? O : never;
