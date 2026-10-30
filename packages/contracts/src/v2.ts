/**
 * Tipos del contrato `atracciones-openapi-v2.yaml`, generados con `npm run contract:types` (no editar el archivo
 * generado). Solo tipos: importarlos con `import type` no carga nada en tiempo de ejecución.
 */
import type { components, paths } from './generated/atracciones-v2';

export type ContractV2Paths = paths;
export type ContractV2Schemas = components['schemas'];
export type ContractV2Schema<Name extends keyof components['schemas']> = components['schemas'][Name];
