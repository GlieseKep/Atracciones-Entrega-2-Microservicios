import { readFileSync } from 'node:fs';
import { load as parse } from 'js-yaml';
import { ESTADOS_RESERVA, SOLICITANTES_CANCELACION, TIPOS_DOCUMENTO, TIPOS_EVENTO_PUBLICO } from './contract';
import { openApiContractPath } from './contract-files';
import { parseSlotId } from './formats';

type Schema = { enum?: string[]; properties?: Record<string, Schema>; items?: Schema; pattern?: string; allOf?: Schema[] };

const spec = parse(readFileSync(openApiContractPath(), 'utf8')) as { components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;

/** Todos los `enum` del contrato v3 que tienen una propiedad con ese nombre. */
function enumsOf(property: string): string[][] {
  const found: string[][] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const s = node as Schema;
    if (s.properties?.[property]?.enum) found.push(s.properties[property].enum!);
    for (const value of Object.values(node as Record<string, unknown>)) visit(value);
  };
  visit(schemas);
  return found;
}

describe('contract · valores cerrados frente al contrato v3', () => {
  it('estados de reserva coinciden con el enum `status` del contrato', () => {
    const statuses = enumsOf('status').filter((e) => e.includes('CONFIRMED'));
    expect(statuses.length).toBeGreaterThan(0);
    for (const e of statuses) expect([...ESTADOS_RESERVA]).toEqual(expect.arrayContaining(e));
  });

  it('los 4 tipos de evento del feed coinciden con `event_type`', () => {
    const types = enumsOf('event_type');
    expect(types.length).toBeGreaterThan(0);
    for (const e of types) expect([...e].sort()).toEqual([...TIPOS_EVENTO_PUBLICO].sort());
  });

  it('solicitantes de cancelación coinciden con `solicitante`', () => {
    for (const e of enumsOf('solicitante')) expect([...e].sort()).toEqual([...SOLICITANTES_CANCELACION].sort());
  });

  it('tipos de documento coinciden con `document_type`', () => {
    for (const e of enumsOf('document_type')) expect([...TIPOS_DOCUMENTO]).toEqual(expect.arrayContaining(e));
  });

  it('slot_id válido e inválido según el formato del contrato', () => {
    expect(parseSlotId('slot-20261120-1030')).not.toBeNull();
    expect(parseSlotId('slot-20261120-10:30')).toBeNull();
  });
});
