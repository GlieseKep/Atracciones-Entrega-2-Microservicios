import { AppError } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { ClienteRequest, RegistroRequest, SesionResponse, UsuarioDto } from '../contract';
import type { SessionRepository } from '../persistence/session-repository';
import type { Db, UserRepository } from '../persistence/user-repository';
import { hashPassword, verifyPassword } from './passwords';
import { randomToken, sha256, signAccessToken } from './tokens';
import type { ClientService } from './client-service';
import type { VerificationService } from './verification-service';

export interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

/** Datos del cliente que se guardan en la sesión. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'El correo o la contraseña son incorrectos.');
const invalidRefresh = () => new AppError(401, 'INVALID_REFRESH_TOKEN', 'El refresh token es inválido, venció o ya se usó.');
const accountDisabled = () => AppError.forbidden('La cuenta está desactivada.', 'ACCOUNT_DISABLED');

export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly verification: VerificationService,
    private readonly clients: ClientService,
    private readonly config: AuthConfig,
  ) {}

  /**
   * Usuario, rol `CLIENTE`, cliente (turista en `cliente_api`, o el que ya existía con ese correo o documento) y token
   * `EMAIL` en una sola transacción. Al terminar se registran los datos de facturación del cliente y se envía el correo.
   */
  async register(input: RegistroRequest): Promise<UsuarioDto> {
    const passwordHash = await hashPassword(input.password);
    const datosCliente: ClienteRequest | null = input.documento
      ? {
          nombre: `${input.nombre} ${input.apellido}`.replace(/\s+/g, ' ').trim().slice(0, 150),
          email: input.correo,
          identificacion: input.documento,
          telefono: input.telefono,
        }
      : null;
    const { user, token, cliente } = await this.dataSource.transaction(async (m) => {
      const id = await this.users.create(m, input, passwordHash);
      await this.users.assignRole(id, 'CLIENTE', null, m);
      const cliente = datosCliente ? (await this.clients.ensureTourist(datosCliente, m)).cliente : null;
      const created = await this.users.findById(id, m);
      return { user: created as UsuarioDto, token: await this.verification.createEmailToken(id, m), cliente };
    });
    if (cliente && datosCliente) await this.clients.ensureBillingAfterSignup(cliente, datosCliente);
    await this.verification.sendVerification(user.correo, token);
    return user;
  }

  async login(correo: string, password: string, client: ClientInfo): Promise<SesionResponse> {
    const account = await this.users.credentialsByEmail(correo);
    if (!(await verifyPassword(password, account?.password ?? null)) || !account) throw invalidCredentials();
    if (!account.activo) throw accountDisabled();
    return this.dataSource.transaction(async (m) => {
      await this.users.touchLastAccess(account.id, m);
      return this.openSession(account.id, client, m);
    });
  }

  /** Revoca la sesión usada y crea otra en la misma transacción: cada refresh token sirve una sola vez. */
  async refresh(refreshToken: string, client: ClientInfo): Promise<SesionResponse> {
    return this.dataSource.transaction(async (m) => {
      const usuId = await this.sessions.consume(sha256(refreshToken), m);
      if (usuId === null) throw invalidRefresh();
      return this.openSession(usuId, client, m);
    });
  }

  private async openSession(usuId: number, client: ClientInfo, db: Db): Promise<SesionResponse> {
    const user = await this.users.findById(usuId, db);
    if (!user?.activo) throw accountDisabled();
    const refreshToken = randomToken();
    const sesId = await this.sessions.create(
      { usuId, tokenHash: sha256(refreshToken), ip: client.ip, userAgent: client.userAgent, expiresInSeconds: this.config.refreshTokenTtlSeconds },
      db,
    );
    return {
      access_token: await signAccessToken({ usuId, sesId, roles: user.roles }, this.config.jwtSecret, this.config.accessTokenTtlSeconds),
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      usuario: user,
    };
  }

  logout(sesId: string): Promise<void> {
    return this.sessions.revoke(sesId);
  }

  /** Mantiene la sesión actual y revoca las demás. */
  async changePassword(usuId: number, sesId: string | null, actual: string, nuevo: string): Promise<void> {
    const account = await this.users.credentialsById(usuId);
    if (!account || !(await verifyPassword(actual, account.password))) {
      throw AppError.validation('La contraseña actual es incorrecta.', [{ name: 'password_actual', reason: 'Es incorrecta.' }], 'INVALID_CURRENT_PASSWORD');
    }
    const passwordHash = await hashPassword(nuevo);
    await this.dataSource.transaction(async (m) => {
      await this.users.setPassword(usuId, passwordHash, m);
      await this.sessions.revokeAll(usuId, m, sesId);
    });
  }
}
