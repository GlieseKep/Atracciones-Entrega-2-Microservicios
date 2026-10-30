import { join, resolve } from 'node:path';

/**
 * Carpeta `packages/contracts` (contrato OpenAPI y protos). `CONTRACTS_DIR` la sobrescribe en los despliegues donde el
 * código empaquetado no conserva la estructura del monorepo.
 */
export const contractsDir = () => process.env.CONTRACTS_DIR ?? resolve(__dirname, '..', '..', 'contracts');

/** Contrato oficial `atracciones-openapi-v2.yaml` (copia exacta, verificada por checksum). */
export const openApiContractPath = () => join(contractsDir(), 'openapi', 'atracciones-openapi-v2.yaml');

/** Proto dentro de `packages/contracts/proto` (p. ej. `booking/inventory.proto`, `internal/order.proto`). */
export const protoPath = (relative: string) => join(contractsDir(), 'proto', relative);
