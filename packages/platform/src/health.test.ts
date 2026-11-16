import type { DataSource } from 'typeorm';
import { checkHealth, checkNodeHealth } from './health';

const stubDb = (query: () => Promise<unknown>) => ({ query: jest.fn(query) }) as unknown as DataSource & { query: jest.Mock };

describe('health · salud de un componente (P13)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('base arriba → UP con database_connected true', async () => {
    const db = stubDb(async () => [{ '?column?': 1 }]);
    await expect(checkHealth('ms-x', db)).resolves.toMatchObject({ status: 'UP', service: 'ms-x', database_connected: true });
    expect(db.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('base caída → DOWN con database_connected false', async () => {
    await expect(checkHealth('ms-x', stubDb(async () => { throw new Error('ECONNREFUSED'); }))).resolves.toMatchObject({ status: 'DOWN', database_connected: false });
  });

  it('componente sin base → UP con database_connected null', async () => {
    await expect(checkHealth('gateway')).resolves.toMatchObject({ status: 'UP', database_connected: null });
  });

  it('checkNodeHealth arma el NodeHealthResponse del contrato v3', async () => {
    const health = await checkNodeHealth('ms-booking', stubDb(async () => []), { nodeId: 'node-1', nodeCode: 'BOOK', version: '1.0.0' });
    expect(Object.keys(health).sort()).toEqual(['database_connected', 'latency_ms', 'memory_usage_mb', 'node_code', 'node_id', 'status', 'timestamp', 'uptime_seconds', 'version']);
    expect(health).toMatchObject({ status: 'UP', node_id: 'node-1', node_code: 'BOOK', version: '1.0.0', database_connected: true });
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
  });
});
