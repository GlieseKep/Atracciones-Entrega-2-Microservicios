/** Rutas del ESB hacia Order (`servicio.operación` → método gRPC), con la misma forma que `GrpcRoute` de `apps/esb/src/routes.ts`. */
export interface OrderGrpcRoute {
  protocol: 'grpc';
  target: 'order';
  proto: 'internal/ms-order.proto';
  service: 'descubre.order.OrderService';
  method: string;
  timeoutMs: number;
}

const route = (method: string, timeoutMs = 3000): OrderGrpcRoute => ({
  protocol: 'grpc', target: 'order', proto: 'internal/ms-order.proto', service: 'descubre.order.OrderService', method, timeoutMs,
});

export const MS_ORDER_ROUTES = {
  'order.health': route('Health', 1000),
  // Crear la orden consulta a Cart, Pricing y Coupon; pagar y cancelar, a Payment.
  'order.createOrder': route('CreateOrder', 9000),
  'order.startPayment': route('StartPayment', 9000),
  'order.cancelOrder': route('CancelOrder', 9000),
  'order.getOrder': route('GetOrder'),
  'order.listOrders': route('ListOrders'),
} as const satisfies Record<string, OrderGrpcRoute>;

export type OrderRouteKey = keyof typeof MS_ORDER_ROUTES;

/** Nombre de la operación para `EsbClient.call('order', operación)` (`order.getOrder` → `getOrder`). */
export type OrderOperation = OrderRouteKey extends `order.${infer O}` ? O : never;
