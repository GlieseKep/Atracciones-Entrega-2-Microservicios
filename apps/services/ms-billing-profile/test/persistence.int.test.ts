import { msDatabase, sqlState, SQLSTATE, type MsDatabase } from '../../../../test/support/db';
import { parseProfile } from '../src/application/profile-input';
import { ProfileRepository } from '../src/persistence/profile-repository';

const profile = (identificacion = '1710034065') => parseProfile({ tipo_identificacion: 'CEDULA', identificacion, razon_social: 'Ana Pérez', correo: 'ana@correo.com' });

describe('ms-billing-profile · persistencia en ms_billing_profile (P7)', () => {
  let db: MsDatabase;
  let profiles: ProfileRepository;

  beforeAll(async () => {
    db = await msDatabase('ms-billing-profile');
    profiles = new ProfileRepository(db.dataSource);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('turista nuevo: su primer perfil queda principal; repetir ensureForClient no crea otro', async () => {
    const first = await profiles.ensureForClient(77, profile());
    expect(first).toMatchObject({ es_principal: true });
    await expect(profiles.ensureForClient(77, profile())).resolves.toMatchObject({ id: first.id });
    const second = await profiles.ensureForClient(77, parseProfile({ tipo_identificacion: 'PASAPORTE', identificacion: 'AB123456', razon_social: 'Ana', correo: 'ana@correo.com' }));
    expect(second.es_principal).toBe(false);
  });

  it('restricción: un solo perfil principal por cliente', async () => {
    const state = await sqlState(db.dataSource.query(`UPDATE dato_facturacion SET dfa_es_principal = TRUE WHERE cla_id = 77`));
    expect(state).toBe(SQLSTATE.unique);
    await expect(profiles.findPrincipalForClient(77)).resolves.toMatchObject({ identificacion: '1710034065' });
  });
});
