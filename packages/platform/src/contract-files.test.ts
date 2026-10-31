import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { callUnary, grpc, insecureClient, loadProto, serviceConstructor } from './grpc';
import { openApiContractPath, protoPath } from './contract-files';
import { startBookingMock } from '../../../apps/booking-mock/src';

/**
 * SHA-256 de la copia del contrato v3 (`Plan/PlanBooking/atracciones-openapi-v3(1).yaml`), con un solo cambio: la
 * respuesta 200 de `GET /atracciones` es el listado simple de la guía de socios. Si cambia, hay que revisar la Partner API.
 */
const CONTRACT_SHA256 = '85A507EAEB65F5D274D39B4BF2506A38BED60EE1118CC837C184467DB6F3CD82';
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();

describe('contrato congelado', () => {
  it('la copia del contrato no se modificó', () => {
    expect(sha256(openApiContractPath())).toBe(CONTRACT_SHA256);
  });

  it('el proto es la copia del oficial de Booking (más nuevo que el bloque protobuf del contrato)', () => {
    const official = join(__dirname, '..', '..', '..', 'Plan', 'PlanBooking', 'inventory.proto');
    const text = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (existsSync(official)) expect(text(protoPath('booking/inventory.proto'))).toBe(text(official));
  });

  it('el proto oficial define InventoryStockService con sus tres RPC', () => {
    const service = serviceConstructor(loadProto('booking/inventory.proto'), 'inventory.InventoryStockService');
    expect(Object.keys(service.service).sort()).toEqual(['GetSlotAvailability', 'PushStockUpdate', 'StreamInventoryChanges']);
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
      // El proto oficial agregó `slot_id`; sin enviarlo llega vacío.
      expect(mock.received.pushes).toEqual([{ ...message, slot_id: '' }]);

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
