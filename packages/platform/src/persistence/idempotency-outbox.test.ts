import type { DataSource, EntityManager } from 'typeorm';
import { runWithContext } from '../correlation';
import type { Principal } from '../principal';
import { IdempotencyStore, payloadHash } from './idempotency';
import { recordEvent } from './outbox';

interface Row {
  id: string;
  principal_tipo: string;
  principal_id: string;
  operacion: string;
  clave: string;
  hash_solicitud: string;
  status_http: number | null;
  cuerpo_respuesta: unknown;
  creado_en: Date;
  completado_en: Date | null;
  expira_en: Date;
}

/** Fake de la tabla `idempotencia`: interpreta las consultas de IdempotencyStore sobre un arreglo en memoria. */
class FakeIdempotencyTable {
  rows: Row[] = [];
  private seq = 0;

  query = async (sql: string, params: unknown[] = []): Promise<unknown> => {
    if (sql.includes('SELECT id, hash_solicitud')) {
      const [tipo, id, op, clave] = params;
      return this.rows.filter((r) => r.principal_tipo === tipo && r.principal_id === id && r.operacion === op && r.clave === clave);
    }
    if (sql.startsWith('DELETE FROM idempotencia WHERE id = $1')) {
      this.rows = this.rows.filter((r) => r.id !== params[0] || (sql.includes('completado_en IS NULL') && r.completado_en));
      return [];
    }
    if (sql.includes('INSERT INTO idempotencia')) {
      const [tipo, id, op, clave, hash, hours] = params as [string, string, string, string, string, number];
      if (this.rows.some((r) => r.principal_tipo === tipo && r.principal_id === id && r.operacion === op && r.clave === clave)) return [];
      const row: Row = { id: `r${++this.seq}`, principal_tipo: tipo, principal_id: id, operacion: op, clave, hash_solicitud: hash, status_http: null, cuerpo_respuesta: null, creado_en: new Date(), completado_en: null, expira_en: new Date(Date.now() + hours * 3600_000) };
      this.rows.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes('UPDATE idempotencia SET status_http')) {
      const row = this.rows.find((r) => r.id === params[0])!;
      Object.assign(row, { status_http: params[1], cuerpo_respuesta: JSON.parse(params[2] as string), completado_en: new Date() });
      return [];
    }
    throw new Error(`SQL no esperado en el fake: ${sql}`);
  };

  dataSource(): DataSource {
    return { query: this.query, transaction: (work: (m: EntityManager) => unknown) => work({ query: this.query } as unknown as EntityManager) } as unknown as DataSource;
  }
}

const SOCIO: Principal = { tipo: 'API_CLIENTE', id: 'socio-1', scopes: [] };

describe('persistence/idempotency y outbox · con repositorio falso', () => {
  let table: FakeIdempotencyTable;
  let store: IdempotencyStore;

  beforeEach(() => {
    table = new FakeIdempotencyTable();
    store = new IdempotencyStore(table.dataSource());
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('P7 · clave nueva → registro para completar', async () => {
    const start = await store.begin(SOCIO, 'CreateReservation', 'k-1', { slot: 'a' });
    expect(start).toEqual({ recordId: 'r1' });
    expect(table.rows[0].hash_solicitud).toBe(payloadHash({ slot: 'a' }));
  });

  it('P7 · clave repetida y completada → devuelve la respuesta guardada', async () => {
    const start = (await store.begin(SOCIO, 'CreateReservation', 'k-1', { slot: 'a', pax: 2 })) as { recordId: string };
    await store.complete(start.recordId, { status: 201, body: { pnr: 'ABC123' } });
    // mismo cuerpo con otro orden de claves → mismo hash
    await expect(store.begin(SOCIO, 'CreateReservation', 'k-1', { pax: 2, slot: 'a' })).resolves.toEqual({ replay: { status: 201, body: { pnr: 'ABC123' } } });
  });

  it('P7 · clave en curso → 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    await store.begin(SOCIO, 'CreateReservation', 'k-1', {});
    await expect(store.begin(SOCIO, 'CreateReservation', 'k-1', {})).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' });
  });

  it('P7 · misma clave con otro cuerpo → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const start = (await store.begin(SOCIO, 'CreateReservation', 'k-1', { slot: 'a' })) as { recordId: string };
    await store.complete(start.recordId, { status: 201, body: {} });
    await expect(store.begin(SOCIO, 'CreateReservation', 'k-1', { slot: 'b' })).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('P7 · solicitud en curso abandonada hace más de 2 min se descarta y se vuelve a procesar', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') });
    await store.begin(SOCIO, 'CreateReservation', 'k-1', {});
    jest.setSystemTime(new Date('2026-11-20T12:02:01Z'));
    await expect(store.begin(SOCIO, 'CreateReservation', 'k-1', {})).resolves.toEqual({ recordId: 'r2' });
    expect(table.rows).toHaveLength(1);
  });

  it('outbox · recordEvent arma el evento con tipo, agregado, carga y el correlation_id actual', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const id = await runWithContext({ correlationId: 'cid-outbox' }, () =>
      recordEvent({ query } as unknown as EntityManager, { tipoEvento: 'RESERVA_CREADA', agregadoId: 'PNR1', payload: { a: 1 } }, 'schema_atracciones'),
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO schema_atracciones.outbox');
    expect(params).toEqual([id, 'RESERVA_CREADA', 'PNR1', '{"a":1}', 'cid-outbox']);
  });
});
