import { SignJWT } from 'jose';
import { runWithContext } from './correlation';
import { requirePrincipal, signInternalPrincipal, verifyInternalPrincipal, type Principal } from './principal';

const SECRET = 'secreto-interno-de-pruebas-con-mas-de-32-caracteres';
const SOCIO: Principal = { tipo: 'API_CLIENTE', id: '7f0c1d2e-0000-4000-8000-000000000001', scopes: ['attractions:read', 'attractions:book'], nombre: 'Booking' };

describe('principal · token interno firmado por el Gateway (T1)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('firma y verifica el principal de un socio', async () => {
    const token = await signInternalPrincipal(SOCIO, SECRET);
    await expect(verifyInternalPrincipal(token, SECRET)).resolves.toEqual({ ...SOCIO, email: null });
  });

  it('principal de tipo USUARIO conserva correo y roles', async () => {
    const user: Principal = { tipo: 'USUARIO', id: 'u-1', scopes: ['ADMIN'], nombre: 'Ana', email: 'ana@correo.com' };
    await expect(verifyInternalPrincipal(await signInternalPrincipal(user, SECRET), SECRET)).resolves.toEqual(user);
  });

  it('firma alterada → 401', async () => {
    const token = await signInternalPrincipal(SOCIO, SECRET);
    const [h, p, s] = token.split('.');
    const tampered = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;
    await expect(verifyInternalPrincipal(tampered, SECRET)).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('secreto distinto → 401', async () => {
    const token = await signInternalPrincipal(SOCIO, SECRET);
    await expect(verifyInternalPrincipal(token, `${SECRET}-otro`)).rejects.toMatchObject({ status: 401 });
  });

  it('principal vencido → 401', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') });
    const token = await signInternalPrincipal(SOCIO, SECRET, 60);
    jest.setSystemTime(new Date('2026-11-20T12:02:00Z'));
    await expect(verifyInternalPrincipal(token, SECRET)).rejects.toMatchObject({ status: 401 });
  });

  it('token sin emisor/audiencia del Gateway → 401; sin principal en el contexto → requirePrincipal 401', async () => {
    const foreign = await new SignJWT({ tipo: 'API_CLIENTE' }).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setExpirationTime('1m').sign(new TextEncoder().encode(SECRET));
    await expect(verifyInternalPrincipal(foreign, SECRET)).rejects.toMatchObject({ status: 401 });
    await expect(runWithContext({ correlationId: 'cid-1' }, () => requirePrincipal(SECRET))).rejects.toMatchObject({ status: 401 });
  });
});
