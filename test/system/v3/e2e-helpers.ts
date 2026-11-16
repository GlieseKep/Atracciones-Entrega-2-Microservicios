import '../../support/rabbit-env';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { load } from 'js-yaml';
import { openApiContractPath } from '@atracciones/platform';
import type { Response } from 'supertest';
import { seedV3, type SeedV3 } from '../../fixtures/v3/seed';
import { cleanTestBus, testBus, trackQueue } from '../../support/bus';
import { startStack, type Stack, type StackOptions } from '../../support/stack';

/** Contrato v3: los esquemas de `components.schemas` para validar cada respuesta E2E (plan §5). */
const spec = load(readFileSync(openApiContractPath(), 'utf8')) as { components: { schemas: Record<string, unknown> } };
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
// OpenAPI 3.0 usa `example`, que ajv no conoce (`nullable` ya lo entiende).
ajv.addKeyword('example');
ajv.addSchema({ $id: 'contract', components: spec.components } as never);

/** Valida un cuerpo contra `#/components/schemas/<nombre>` (o un arreglo de ese esquema). */
export function expectSchema(body: unknown, schema: string, array = false): void {
  const ref = { $ref: `contract#/components/schemas/${schema}` };
  const validate = ajv.compile(array ? { type: 'array', items: ref } : ref);
  if (!validate(body)) throw new Error(`La respuesta no cumple ${schema}: ${ajv.errorsText(validate.errors)}`);
}

/** Toda respuesta del Gateway trae X-Correlation-Id; un error, además, es application/problem+json del contrato. */
export function expectContractHeaders(res: Response): void {
  expect(res.headers['x-correlation-id']).toBeTruthy();
  if (res.status >= 400) {
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: res.status, code: expect.any(String), correlation_id: res.headers['x-correlation-id'], timestamp: expect.any(String) });
  }
}

export interface E2E {
  stack: Stack;
  seed: SeedV3;
  close(): Promise<void>;
}

/** Sistema completo para un archivo E2E: los 12 ms-*, ESB, Partner API y Gateway, con RabbitMQ local y sus datos. */
export async function startE2E(options: StackOptions = {}): Promise<E2E> {
  const bus = await testBus();
  for (const queue of ['ms-booking', 'ms-catalog', 'ms-order']) trackQueue(queue);
  const stack = await startStack({ ...options, bus, edge: true });
  const seed = await seedV3(stack);
  await stack.pumpEvents();
  return {
    stack,
    seed,
    async close() {
      await stack.close();
      await bus.close();
      await cleanTestBus();
    },
  };
}
