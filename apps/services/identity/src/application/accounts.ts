import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, type InvalidParam, type Principal } from '@atracciones/platform';
import type { IdentityRepository } from '../persistence/repositories';
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from './passwords';
import type { TokenIssuer } from './tokens';

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const API_KEY = /^atr_([A-Za-z0-9]{12})_([A-Za-z0-9_-]{43})$/;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function randomBase62(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => BASE62[b % BASE62.length]).join('');
}

export interface RegisterInput {
  email?: unknown;
  password?: unknown;
  nombre_completo?: unknown;
}

export interface LoginResult {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}

/** Casos de uso de cuentas: registro, inicio de sesión y claves de API de socios (M2M). */
export class AccountService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly tokens: TokenIssuer,
  ) {}

  async register(input: RegisterInput): Promise<{ id: string; email: string }> {
    const invalid: InvalidParam[] = [];
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const nombre = typeof input.nombre_completo === 'string' ? input.nombre_completo.trim() : '';
    if (!EMAIL.test(email) || email.length > 254) invalid.push({ name: 'email', reason: 'Debe ser un correo electrónico válido.' });
    if (password.length < 8 || password.length > 128) invalid.push({ name: 'password', reason: 'Debe tener entre 8 y 128 caracteres.' });
    if (nombre.length < 2 || nombre.length > 200) invalid.push({ name: 'nombre_completo', reason: 'Debe tener entre 2 y 200 caracteres.' });
    if (invalid.length > 0) throw AppError.validation('Los datos de registro no son válidos.', invalid);

    const passwordHash = await hashPassword(password);
    const id = await this.repo.transaction(async (tx) => {
      const created = await tx.insertUser({ email, passwordHash, nombre, tipo: 'PERSONA' });
      if (created) await tx.assignRole(created, 'cliente', 'Registro en el portal');
      return created;
    });
    if (!id) throw AppError.conflict('EMAIL_ALREADY_REGISTERED', 'Ya existe una cuenta con ese correo.');
    return { id, email };
  }

  async login(input: { email?: unknown; password?: unknown }): Promise<LoginResult> {
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const user = email ? await this.repo.findUserByEmail(email) : null;
    // Se verifica siempre una contraseña (real o de referencia) para no revelar qué correos existen.
    const valid = await verifyPassword(password, user?.password_hash ?? (await DUMMY_HASH_PROMISE));
    if (!user || !valid) throw AppError.unauthorized('Correo o contraseña incorrectos.');
    if (user.estado !== 'ACTIVO') throw AppError.forbidden('La cuenta no está activa.', 'ACCOUNT_DISABLED');

    const scopes = await this.repo.scopesOf(user.id);
    const { token, expiresIn } = await this.tokens.issue({ sub: user.id, email: user.email, name: user.nombre_completo, tipo: user.tipo, scopes });
    return { access_token: token, token_type: 'Bearer', expires_in: expiresIn, scope: scopes.join(' ') };
  }

  /**
   * Crea el primer administrador (tipo ADMIN, rol `admin`) si todavía no existe una cuenta con ese correo. Lo usa el
   * arranque del servicio con `ADMIN_EMAIL` / `ADMIN_PASSWORD`; una cuenta existente no se modifica.
   */
  async ensureAdmin(input: { email: string; password: string; nombre?: string }): Promise<{ id: string; created: boolean }> {
    const existing = await this.repo.findUserByEmail(input.email);
    if (existing) return { id: existing.id, created: false };
    if (input.password.length < 8) throw new Error('ADMIN_PASSWORD debe tener al menos 8 caracteres.');
    const passwordHash = await hashPassword(input.password);
    const id = await this.repo.transaction(async (tx) => {
      const created = await tx.insertUser({ email: input.email.trim().toLowerCase(), passwordHash, nombre: input.nombre ?? 'Administrador de la tienda', tipo: 'ADMIN' });
      if (created) await tx.assignRole(created, 'admin', 'Administrador inicial (ADMIN_EMAIL)');
      return created;
    });
    return { id: id ?? (await this.repo.findUserByEmail(input.email))!.id, created: id !== null };
  }

  /** Valida una `X-API-Key` y devuelve el principal del socio, o 401 si no es válida, está inactiva o revocada. */
  async verifyApiKey(apiKey: unknown): Promise<Principal> {
    const match = typeof apiKey === 'string' ? API_KEY.exec(apiKey) : null;
    const client = match ? await this.repo.findApiClientByPrefix(match[1]) : null;
    const expected = Buffer.from(client?.clave_hash ?? sha256('clave-de-referencia'), 'utf8');
    const actual = Buffer.from(sha256(typeof apiKey === 'string' ? apiKey : ''), 'utf8');
    const valid = client !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!client || !valid || !client.activo || client.revocado_en) throw AppError.unauthorized('La X-API-Key no es válida.');
    void this.repo.touchApiClient(client.id).catch(() => undefined);
    return { tipo: 'API_CLIENTE', id: client.id, scopes: client.scopes, nombre: client.nombre };
  }

  /**
   * Crea un usuario socio (tipo PARTNER, rol `partner`) con su clave de API. La clave solo se muestra aquí: en la base
   * se guarda su SHA-256. Los scopes son los del rol `partner`.
   */
  async createApiKey(input: { nombre: string; email: string }): Promise<{ apiClienteId: string; apiKey: string; scopes: string[] }> {
    const prefix = randomBase62(12);
    const apiKey = `atr_${prefix}_${randomBytes(32).toString('base64url')}`;
    return this.repo.transaction(async (tx) => {
      let usuario = await tx.findUserByEmail(input.email);
      if (!usuario) {
        const id = await tx.insertUser({ email: input.email.toLowerCase(), passwordHash: await hashPassword(randomBytes(32).toString('base64url')), nombre: input.nombre, tipo: 'PARTNER' });
        if (!id) throw AppError.conflict('EMAIL_ALREADY_REGISTERED', 'Ya existe una cuenta con ese correo.');
        usuario = { id, email: input.email, password_hash: '', nombre_completo: input.nombre, tipo: 'PARTNER', estado: 'ACTIVO' };
      }
      await tx.assignRole(usuario.id, 'partner', `Clave de API ${input.nombre}`);
      const scopes = await tx.scopesOfRole('partner');
      const apiClienteId = await tx.insertApiClient({ nombre: input.nombre, usuarioId: usuario.id, prefix, hash: sha256(apiKey), scopes });
      return { apiClienteId, apiKey, scopes };
    });
  }
}
