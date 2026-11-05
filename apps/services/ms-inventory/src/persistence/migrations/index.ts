import { InventorySchema1796000000500 } from './1796000000500-InventorySchema';
import { InventoryGuides1796000000510 } from './1796000000510-InventoryGuides';
import { InventoryStockRetry1796000000520 } from './1796000000520-InventoryStockRetry';

/** Migraciones en orden. Se registran como clases para que funcionen igual compiladas y en las pruebas. */
export const MIGRATIONS = [InventorySchema1796000000500, InventoryGuides1796000000510, InventoryStockRetry1796000000520];
