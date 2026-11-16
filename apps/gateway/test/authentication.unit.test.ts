import { AppError, type EsbClient } from '@atracciones/platform';
import { Authenticator, PARTNER_SCOPES } from '../src/authentication';
import type { GatewayConfig } from '../src/config';

const CONFIG = { apiKeyCacheMs: 60_000, tokenCacheMs: 30_000 } as GatewayConfig;

/** Spy del cliente ESB: solo se dobla la dependencia, el Authenticator es real. */
function esbSpy(impl: (service: string, operation: string, input: Record<string, string>) => unknown) {
  const call = jest.fn(async (service: string, operation: string, input: object) => impl(service, operation, input as Record<string, string>));
  return { esb: { call } as unknown as EsbClient, call };
}

const SOCIO = { tipo: 'CLIENTE_API', id: 7, nombre: 'Booking Central', roles: [] };
const USUARIO = { tipo: 'USUARIO', id: 3, nombre: 'Ana', roles: ['ADMIN'] };

describe('gateway/authentication · T1', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sin credencial → sigue como anónima (null) sin llamar a ms-identity', async () => {
    const { esb, call } = esbSpy(() => SOCIO);
    await expect(new Authenticator(CONFIG, esb).authenticate({})).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('Bearer válido → principal USUARIO con sus roles', async () => {
    const { esb, call } = esbSpy(() => USUARIO);
    await expect(new Authenticator(CONFIG, esb).authenticate({ authorization: 'Bearer abc.def.ghi' })).resolves.toEqual({ tipo: 'USUARIO', id: '3', scopes: ['ADMIN'], nombre: 'Ana', email: null });
    expect(call).toHaveBeenCalledWith('identity', 'validateToken', { token: 'abc.def.ghi' }, { timeoutMs: 3000 });
  });

  it('Authorization mal formado → 401 sin llamar a ms-identity', async () => {
    const { esb, call } = esbSpy(() => USUARIO);
    await expect(new Authenticator(CONFIG, esb).authenticate({ authorization: 'Basic dXNlcjpwYXNz' })).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(call).not.toHaveBeenCalled();
  });

  it('JWT vencido (ms-identity responde 401) → 401', async () => {
    const { esb } = esbSpy(() => { throw AppError.unauthorized('Token expirado.'); });
    await expect(new Authenticator(CONFIG, esb).authenticate({ authorization: 'Bearer vencido' })).rejects.toMatchObject({ status: 401 });
  });

  it('X-API-Key válida → principal API_CLIENTE con los scopes de socio', async () => {
    const { esb, call } = esbSpy(() => SOCIO);
    const principal = await new Authenticator(CONFIG, esb).authenticate({ 'x-api-key': 'clave-socio' });
    expect(principal).toEqual({ tipo: 'API_CLIENTE', id: '7', scopes: PARTNER_SCOPES, nombre: 'Booking Central', email: null });
    expect(principal?.scopes).not.toContain('attractions:write');
    expect(call).toHaveBeenCalledWith('identity', 'validateApiKey', { api_key: 'clave-socio' }, { timeoutMs: 3000 });
  });

  it('X-API-Key inactiva (ms-identity responde 401) → 401', async () => {
    const { esb } = esbSpy(() => { throw AppError.unauthorized('La clave está inactiva.'); });
    await expect(new Authenticator(CONFIG, esb).authenticate({ 'x-api-key': 'inactiva' })).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('ambas cabeceras → gana Authorization', async () => {
    const { esb, call } = esbSpy((_s, op) => (op === 'validateToken' ? USUARIO : SOCIO));
    await expect(new Authenticator(CONFIG, esb).authenticate({ authorization: 'Bearer t', 'x-api-key': 'k' })).resolves.toMatchObject({ tipo: 'USUARIO' });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][1]).toBe('validateToken');
  });

  it('caché: la segunda validación de la misma llave no llama a ms-identity', async () => {
    const { esb, call } = esbSpy(() => SOCIO);
    const auth = new Authenticator(CONFIG, esb);
    await auth.authenticate({ 'x-api-key': 'k' });
    await auth.authenticate({ 'x-api-key': 'k' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('caché vencida: vuelve a validar en ms-identity', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') });
    const { esb, call } = esbSpy(() => SOCIO);
    const auth = new Authenticator(CONFIG, esb);
    await auth.authenticate({ 'x-api-key': 'k' });
    jest.setSystemTime(new Date('2026-11-20T12:01:00.001Z'));
    await auth.authenticate({ 'x-api-key': 'k' });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('ms-identity caído → 503 y no se guarda en caché', async () => {
    let down = true;
    const { esb, call } = esbSpy(() => { if (down) throw AppError.unavailable(); return SOCIO; });
    const auth = new Authenticator(CONFIG, esb);
    await expect(auth.authenticate({ 'x-api-key': 'k' })).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    down = false;
    await expect(auth.authenticate({ 'x-api-key': 'k' })).resolves.toMatchObject({ tipo: 'API_CLIENTE' });
    expect(call).toHaveBeenCalledTimes(2);
  });
});
