/** Rutas del ESB hacia Inventory (`servicio.operación` → método gRPC), con la misma forma que `GrpcRoute` de `apps/esb/src/routes.ts`. */
export interface InventoryGrpcRoute {
  protocol: 'grpc';
  target: 'inventory';
  proto: 'internal/ms-inventory.proto';
  service: 'descubre.inventory.InventoryService';
  method: string;
  timeoutMs: number;
}

const route = (method: string, timeoutMs = 2000): InventoryGrpcRoute => ({
  protocol: 'grpc', target: 'inventory', proto: 'internal/ms-inventory.proto', service: 'descubre.inventory.InventoryService', method, timeoutMs,
});

export const MS_INVENTORY_ROUTES = {
  'inventory.health': route('Health', 1000),
  'inventory.getAvailability': route('GetAvailability'),
  'inventory.filterAvailableAttractions': route('FilterAvailableAttractions'),
  'inventory.reserveSeats': route('ReserveSeats'),
  'inventory.releaseSeats': route('ReleaseSeats'),
  'inventory.getSlotsByIds': route('GetSlotsByIds'),

  // Administración: consultan los permisos en Catalog, y generar turnos puede tardar.
  'inventory.listSchedules': route('ListSchedules', 5000),
  'inventory.saveSchedule': route('SaveSchedule', 10000),
  'inventory.setScheduleActive': route('SetScheduleActive', 10000),
  'inventory.listSlots': route('ListSlots', 5000),
  'inventory.setSlotCapacity': route('SetSlotCapacity', 5000),
  'inventory.setSlotClosed': route('SetSlotClosed', 5000),
  'inventory.listBlockedDates': route('ListBlockedDates', 5000),
  'inventory.blockDate': route('BlockDate', 5000),
  'inventory.unblockDate': route('UnblockDate', 10000),
} as const satisfies Record<string, InventoryGrpcRoute>;

export type InventoryRouteKey = keyof typeof MS_INVENTORY_ROUTES;

/** Nombre de la operación para `EsbClient.call('inventory', operación)` (`inventory.getAvailability` → `getAvailability`). */
export type InventoryOperation = InventoryRouteKey extends `inventory.${infer O}` ? O : never;
