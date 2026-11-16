import { AppError, createLogger, signInternalPrincipal, type EsbClient } from '@atracciones/platform';
import { SignJWT } from 'jose';
import type { DataSource, EntityManager } from 'typeorm';
import type { ApiClientRepository } from '../persistence/api-client-repository';
import type { SessionRepository } from '../persistence/session-repository';
import type { UserRepository } from '../persistence/user-repository';
import { ApiClientService } from './api-client-service';
import { ClientService } from './client-service';
import { CredentialValidator } from './credential-validator';
import { parseCliente, parseClienteFiltros } from './input';
import { sha256, signAccessToken, verifyAccessToken } from './tokens';

process.env.LOG_SILENT = 'true';
const logger = createLogger('pruebas');
const JWT = 'secreto-jwt-de-pruebas-con-mas-de-32-caracteres-aa';
const INTERNAL = 'secreto-interno-de-pruebas-con-mas-de-32-caracteres';

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ms-identity/tokens · JWT de acceso (T1)', () => {
  it('firma y verifica sub, sid y roles', async () => {
    const token = await signAccessToken({ usuId: 3, sesId: 's-1', roles: ['ADMIN'] }, JWT, 60);
    await expect(verifyAccessToken(token, JWT)).resolves.toEqual({ usuId: 3, sesId: 's-1', roles: ['ADMIN'] });
  });
  it('vencido → null', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') });
    const token = await signAccessToken({ usuId: 3, sesId: 's', roles: [] }, JWT, 60);
    jest.setSystemTime(new Date('2026-11-20T12:02:00Z'));
    await expect(verifyAccessToken(token, JWT)).resolves.toBeNull();
  });
  it('otro secreto → null', async () => {
    await expect(verifyAccessToken(await signAccessToken({ usuId: 3, sesId: 's', roles: [] }, JWT, 60), `${JWT}x`)).resolves.toBeNull();
  });
  it('sin sid o con sub no numérico → null; roles desconocidos se descartan', async () => {
    const bad = await new SignJWT({ roles: ['ADMIN'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('abc').setExpirationTime('1m').sign(new TextEncoder().encode(JWT));
    await expect(verifyAccessToken(bad, JWT)).resolves.toBeNull();
    const extra = await new SignJWT({ sid: 's', roles: ['ADMIN', 'HACKER'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('3').setExpirationTime('1m').sign(new TextEncoder().encode(JWT));
    await expect(verifyAccessToken(extra, JWT)).resolves.toMatchObject({ roles: ['ADMIN'] });
  });
  it('sha256 es determinista y en hex', () => {
    expect(sha256('clave')).toBe(sha256('clave'));
    expect(sha256('clave')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('ms-identity/credential-validator · validateToken y validateApiKey (T1)', () => {
  function validator(opts: { sessionActive?: boolean; user?: { id: number; nombre: string; apellido: string; activo: boolean; roles: string[] } | null; client?: { id: number; nombre: string } | null } = {}) {
    const sessions = { isActive: jest.fn(async () => opts.sessionActive ?? true) } as unknown as SessionRepository;
    const users = { findById: jest.fn(async () => (opts.user === undefined ? { id: 3, nombre: 'Ana', apellido: 'Pérez', activo: true, roles: ['CLIENTE'] } : opts.user)) } as unknown as UserRepository;
    const useKey = jest.fn(async () => (opts.client === undefined ? { id: 9, nombre: 'Booking' } : opts.client));
    const apiClients = { useKey } as unknown as ApiClientRepository;
    return { v: new CredentialValidator(users, sessions, apiClients, JWT, INTERNAL), useKey };
  }

  it('JWT válido con sesión activa y usuario activo → principal USUARIO con roles de la base', async () => {
    const token = await signAccessToken({ usuId: 3, sesId: 's-1', roles: [] }, JWT, 60);
    await expect(validator().v.validateToken(token)).resolves.toEqual({ principal: { tipo: 'USUARIO', id: 3, nombre: 'Ana Pérez', roles: ['CLIENTE'] }, sesId: 's-1' });
  });
  it('sesión revocada o usuario inactivo → 401', async () => {
    const token = await signAccessToken({ usuId: 3, sesId: 's-1', roles: [] }, JWT, 60);
    await expect(validator({ sessionActive: false }).v.validateToken(token)).rejects.toMatchObject({ status: 401 });
    await expect(validator({ user: { id: 3, nombre: 'a', apellido: 'b', activo: false, roles: [] } }).v.validateToken(token)).rejects.toMatchObject({ status: 401 });
  });
  it('X-API-Key: se busca por su SHA-256, nunca en claro', async () => {
    const { v, useKey } = validator();
    await expect(v.validateApiKey('clave-socio')).resolves.toEqual({ tipo: 'CLIENTE_API', id: 9, nombre: 'Booking', roles: [] });
    expect(useKey).toHaveBeenCalledWith(sha256('clave-socio'));
  });
  it('llave inexistente o inactiva (el repositorio no la devuelve) → 401', async () => {
    await expect(validator({ client: null }).v.validateApiKey('x')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });
  it('principal interno de un socio no sirve para operaciones de usuario → 403', async () => {
    const token = await signInternalPrincipal({ tipo: 'API_CLIENTE', id: '9', scopes: [] }, INTERNAL);
    await expect(validator().v.validateInternalPrincipal(token)).rejects.toMatchObject({ status: 403 });
  });
});

describe('ms-identity/api-client-service · claves de socios', () => {
  const tx = { transaction: (work: (m: EntityManager) => unknown) => work({ query: jest.fn(async () => []) } as unknown as EntityManager) } as unknown as DataSource;

  it('al crear, la clave solo existe en la respuesta: se guarda su hash', async () => {
    const create = jest.fn(async (codigo: string, nombre: string, _hash: string) => ({ id: 1, codigo, nombre, activo: true }));
    const created = await new ApiClientService(tx, { create } as unknown as ApiClientRepository).create('BOOKING', 'Booking', 1);
    expect(created.api_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(create.mock.calls[0][2]).toBe(sha256(created.api_key));
  });
  it('regenerar la clave: nueva clave y hash distinto', async () => {
    const setKey = jest.fn(async (id: number, _hash: string) => ({ id, codigo: 'B', nombre: 'B', activo: true }));
    const service = new ApiClientService(tx, { setKey } as unknown as ApiClientRepository);
    const a = await service.regenerateKey(1);
    const b = await service.regenerateKey(1);
    expect(a.api_key).not.toBe(b.api_key);
  });
  it('desactivar (llave inactiva) devuelve el cliente; inexistente → 404 API_CLIENT_NOT_FOUND', async () => {
    const repo = { activeState: jest.fn(async (id: number) => (id === 1 ? true : null)), setActive: jest.fn(async (id: number, activo: boolean) => ({ id, codigo: 'B', nombre: 'B', activo })) } as unknown as ApiClientRepository;
    const service = new ApiClientService(tx, repo);
    await expect(service.setActive(1, false, 1)).resolves.toMatchObject({ activo: false });
    await expect(service.setActive(2, false, 1)).rejects.toMatchObject({ status: 404, code: 'API_CLIENT_NOT_FOUND' });
  });
  it('renombrar un cliente inexistente → 404', async () => {
    await expect(new ApiClientService(tx, { rename: jest.fn(async () => null) } as unknown as ApiClientRepository).rename(5, 'x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('ms-identity/client-service · ensureClient del titular de una compra (P7)', () => {
  const TURISTA = { client_id: '77', nombre: 'Ana Pérez', email: 'ana@correo.com', identificacion: '1710034065', telefono: '0991234567' };
  const datos = { nombre: 'Ana Pérez', email: 'ana@correo.com', identificacion: '1710034065', telefono: '0991234567' };
  function service(found: unknown[][], created: unknown = TURISTA, billing: () => unknown = () => ({})) {
    const findTourists = jest.fn(async () => found.shift() ?? []);
    const createTourist = jest.fn(async () => created);
    const call = jest.fn(async () => billing());
    return { s: new ClientService({ findTourists, createTourist } as unknown as ApiClientRepository, { call } as unknown as EsbClient, logger), createTourist, call };
  }

  it('no existe → lo crea y registra su perfil de facturación principal en billing-profile', async () => {
    const { s, createTourist, call } = service([[]]);
    await expect(s.ensure(datos as never)).resolves.toEqual({ cliente: TURISTA, creado: true });
    expect(createTourist).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('billing', 'ensurePrincipalForClient', expect.objectContaining({ claId: '77', tipo_identificacion: 'CEDULA', identificacion: '1710034065' }));
  });
  it('ya existe → lo reutiliza sin duplicarlo', async () => {
    const { s, createTourist } = service([[TURISTA]]);
    await expect(s.ensure(datos as never)).resolves.toEqual({ cliente: TURISTA, creado: false });
    expect(createTourist).not.toHaveBeenCalled();
  });
  it('correo de un turista e identificación de otro → 409 CLIENT_DATA_CONFLICT', async () => {
    const { s } = service([[TURISTA, { ...TURISTA, client_id: '78' }]]);
    await expect(s.ensure(datos as never)).rejects.toMatchObject({ status: 409, code: 'CLIENT_DATA_CONFLICT' });
  });
  it('billing-profile caído → 503 (el turista ya quedó registrado)', async () => {
    const { s, createTourist } = service([[]], TURISTA, () => { throw AppError.unavailable(); });
    await expect(s.ensure(datos as never)).rejects.toMatchObject({ status: 503 });
    expect(createTourist).toHaveBeenCalledTimes(1);
  });
});

describe('ms-identity/input · clientes', () => {
  it('cliente válido con teléfono normalizado', () => {
    expect(parseCliente({ nombre: ' Ana   Pérez ', email: 'ANA@correo.com', identificacion: '1710034065', telefono: '099-123 4567' })).toEqual({ nombre: 'Ana Pérez', email: 'ana@correo.com', identificacion: '1710034065', telefono: '0991234567' });
  });
  it('documento inválido, nombre de una palabra y correo inválido → 400 con todos los errores', () => {
    try {
      parseCliente({ nombre: 'Ana', email: 'x', identificacion: '1710034064' });
      throw new Error('no lanzó');
    } catch (e) {
      expect((e as AppError).invalidParams?.map((p) => p.name).sort()).toEqual(['email', 'identificacion', 'nombre']);
    }
  });
  it('filtros de búsqueda: email o identificación obligatorios', () => {
    expect(parseClienteFiltros({ email: 'A@B.COM' })).toEqual({ email: 'a@b.com', identificacion: null });
    expect(() => parseClienteFiltros({})).toThrow(expect.objectContaining({ status: 400 }));
  });
});
