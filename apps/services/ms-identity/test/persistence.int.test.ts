import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { sha256 } from '../src/application/tokens';
import { ApiClientRepository } from '../src/persistence/api-client-repository';

const TURISTA = { nombre: 'Ana Pérez', email: 'ana@correo.com', identificacion: '1710034065', telefono: '0991234567' };

describe('ms-identity · persistencia en ms_identity (T1, P7)', () => {
  let db: MsDatabase;
  let clients: ApiClientRepository;

  beforeAll(async () => {
    db = await msDatabase('ms-identity');
    clients = new ApiClientRepository(db.dataSource);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('T1 · la llave se guarda solo como hash y se encuentra por su hash, registrando el último uso', async () => {
    const created = await clients.create('BOOKING-TEST', 'Booking', sha256('clave-en-claro'));
    const [row] = await db.dataSource.query(`SELECT cla_clave_hash, cla_ultimo_uso FROM cliente_api WHERE cla_codigo = 'BOOKING-TEST'`);
    expect(row.cla_clave_hash).toBe(sha256('clave-en-claro'));
    expect(JSON.stringify(row)).not.toContain('clave-en-claro');
    await expect(clients.useKey(sha256('clave-en-claro'))).resolves.toMatchObject({ id: created.id });
    const [after] = await db.dataSource.query(`SELECT cla_ultimo_uso FROM cliente_api WHERE cla_codigo = 'BOOKING-TEST'`);
    expect(after.cla_ultimo_uso).not.toBeNull();
  });

  it('T1 · llave inactiva no se encuentra; código repetido → 409 CLIENT_CODE_EXISTS', async () => {
    const created = await clients.create('SOCIO-INACTIVO', 'Inactivo', sha256('otra-clave'));
    await clients.setActive(created.id, false);
    await expect(clients.useKey(sha256('otra-clave'))).resolves.toBeNull();
    await expect(clients.create('SOCIO-INACTIVO', 'x', sha256('x'))).rejects.toMatchObject({ status: 409, code: 'CLIENT_CODE_EXISTS' });
  });

  it('P7 · turista de ensureClient único por documento: el segundo alta no crea otra fila', async () => {
    const first = await clients.createTourist(TURISTA);
    expect(first).toMatchObject({ identificacion: '1710034065' });
    await expect(clients.createTourist({ ...TURISTA, email: 'otro@correo.com' })).resolves.toBeNull();
    await expect(clients.findTourists({ email: null, identificacion: '1710034065' })).resolves.toHaveLength(1);
  });
});
