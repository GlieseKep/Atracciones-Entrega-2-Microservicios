// Extrae el proto oficial (`inventory.InventoryStockService`) del bloque ```protobuf del contrato v2 y lo escribe en
// packages/contracts/proto/booking/inventory.proto sin cambiar ni una línea. Uso: node tools/extract-contract-proto.mjs
// La prueba de contrato (packages/contracts/test) comprueba que el archivo siga siendo idéntico al bloque.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Devuelve el bloque protobuf del contrato, sin la sangría que tiene dentro del YAML. */
export function protoFromContract(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '```protobuf');
  const end = lines.findIndex((l, i) => i > start && l.trim() === '```');
  if (start < 0 || end < 0) throw new Error('El contrato no tiene un bloque ```protobuf.');
  const indent = lines[start].indexOf('```');
  return `${lines.slice(start + 1, end).map((l) => l.slice(indent)).join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const yaml = readFileSync(join(root, 'packages', 'contracts', 'openapi', 'atracciones-openapi-v2.yaml'), 'utf8');
  const target = join(root, 'packages', 'contracts', 'proto', 'booking', 'inventory.proto');
  writeFileSync(target, protoFromContract(yaml));
  console.log(`Escrito ${target}`);
}
