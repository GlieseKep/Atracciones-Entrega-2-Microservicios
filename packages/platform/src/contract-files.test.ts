import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { callUnary, grpc, insecureClient, loadProto, serviceConstructor } from './grpc';
import { openApiContractPath, protoPath } from './contract-files';
import { startBookingMock } from '../../../apps/booking-mock/src';

/** SHA-256 del contrato oficial v2.0.0 recibido. Si cambia, hay que revisar el plan y regenerar los tipos. */
const CONTRACT_SHA256 = 'B5B02C0EFE6FC9B6564C6E254C43B9EA580A475D6C2D830AC87A381C5EB24650';
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();

describe('contrato congelado', () => {
  it('la copia del contrato no se modificó', () => {
    expect(sha256(openApiContractPath())).toBe(CONTRACT_SHA256);
    const original = join(__dirname, '..', '..', '..', 'atracciones-openapi-v2.yaml');
    if (existsSync(original)) expect(sha256(original)).toBe(CONTRACT_SHA256);
  });

  it('el proto oficial es idéntico al bloque protobuf del contrato', () => {
    const lines = readFileSync(openApiContractPath(), 'utf8').split(/\r?\n/);
    const start = lines.findIndex((l) => l.trim() === '```protobuf');
    const end = lines.findIndex((l, i) => i > start && l.trim() === '```');
    const indent = lines[start].indexOf('```');
    const block = `${lines.slice(start + 1, end).map((l) => l.slice(indent)).join('\n')}\n`;
    expect(readFileSync(protoPath('booking/inventory.proto'), 'utf8')).toBe(block);
  });

  it('el proto oficial define InventoryStockService con sus dos RPC', () => {
    const service = serviceConstructor(loadProto('booking/inventory.proto'), 'inventory.InventoryStockService');
    expect(Object.keys(service.service).sort()).toEqual(['PushStockUpdate', 'StreamInventoryChanges']);
  });
});

describe('mock de Booking Prototipo', () => {
  it('recibe PushStockUpdate y StreamInventoryChanges y simula una caída', async () => {
    const mock = await startBookingMock(0);
    const client = insecureClient(serviceConstructor(loadProto('booking/inventory.proto'), 'inventory.InventoryStockService'), `127.0.0.1:${mock.grpcPort}`);
    try {
      const message = { service_id: 'atracciones-dilan', item_id: 'PRhu4UBTWPBC', date: '2026-10-25', time_slot: '10:30 a.m.', available_units: 8, timestamp: 1793000000000 };
      const ack = await callUnary<typeof message, { success: boolean; processed_at: number }>(client, 'PushStockUpdate', message);
      expect(ack.success).toBe(true);
      expect(mock.received.pushes).toEqual([message]);

      const summary = await new Promise<{ total_events_processed: number; is_synchronized: boolean }>((resolve, reject) => {
        const call = (client as unknown as { StreamInventoryChanges: Function }).StreamInventoryChanges(
          (error: grpc.ServiceError | null, response: { total_events_processed: number; is_synchronized: boolean }) => (error ? reject(error) : resolve(response)),
        );
        for (const delta of [-2, 1]) {
          call.write({ event_id: `e${delta}`, service_id: 'atracciones-dilan', item_id: 'PRhu4UBTWPBC', date: '2026-10-25', time_slot: '10:30 a.m.', delta, timestamp: 1 });
        }
        call.end();
      });
      expect(summary).toEqual(expect.objectContaining({ total_events_processed: 2, is_synchronized: true }));

      mock.setDown(true);
      await expect(callUnary(client, 'PushStockUpdate', message)).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    } finally {
      client.close();
      await mock.close();
    }
  });
});
