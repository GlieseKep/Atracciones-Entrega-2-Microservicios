import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Carpeta `packages/contracts` (contrato OpenAPI y protos). En el paquete de Azure (`tools/package-microservices.mjs`)
 * el código va incrustado en cada `main.js` y los contratos quedan en `packages/contracts` de la carpeta de trabajo.
 * `CONTRACTS_DIR` la sobrescribe.
 */
export function contractsDir(): string {
  if (process.env.CONTRACTS_DIR) return process.env.CONTRACTS_DIR;
  const packaged = join(process.cwd(), 'packages', 'contracts');
  return existsSync(join(packaged, 'proto')) ? packaged : resolve(__dirname, '..', '..', 'contracts');
}

/** Contrato oficial `atracciones-openapi-v2.yaml` (copia exacta, verificada por checksum). */
export const openApiContractPath = () => join(contractsDir(), 'openapi', 'atracciones-openapi-v3.yaml');

/** Proto dentro de `packages/contracts/proto` (p. ej. `booking/inventory.proto`, `internal/order.proto`). */
export const protoPath = (relative: string) => join(contractsDir(), 'proto', relative);
