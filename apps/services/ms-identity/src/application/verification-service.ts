import { AppError, errorFields, type Logger } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { SessionRepository } from '../persistence/session-repository';
import type { TipoToken, TokenRepository } from '../persistence/token-repository';
import type { Db, UserRepository } from '../persistence/user-repository';
import type { Mailer } from './mailer';
import { hashPassword } from './passwords';
import { randomToken, sha256 } from './tokens';

export interface VerificationConfig {
  /** Base de los enlaces que recibe el usuario. */
  portalUrl: string;
  emailTokenTtlSeconds: number;
  recoveryTokenTtlSeconds: number;
}

const invalidToken = () => AppError.validation('El token es inválido, venció o ya se usó.', undefined, 'INVALID_TOKEN');

export class VerificationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenRepository,
    private readonly mailer: Mailer,
    private readonly config: VerificationConfig,
    private readonly logger: Logger,
  ) {}

  /** Crea el token de verificación dentro de la transacción del llamador; devuelve el valor para enviarlo al terminar. */
  async createEmailToken(usuId: number, db: Db): Promise<string> {
    return this.createToken(usuId, 'EMAIL', this.config.emailTokenTtlSeconds, db);
  }

  private async createToken(usuId: number, tipo: TipoToken, ttlSeconds: number, db?: Db): Promise<string> {
    const token = randomToken();
    await this.tokens.create(usuId, tipo, sha256(token), ttlSeconds, db);
    return token;
  }

  /** Un fallo del correo no revierte la operación: el usuario puede pedir el enlace otra vez. */
  async sendVerification(correo: string, token: string): Promise<void> {
    await this.deliver(() => this.mailer.sendVerification(correo, `${this.config.portalUrl}/verificar-correo?token=${token}`));
  }

  private async deliver(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error('no se pudo enviar el correo', errorFields(error));
    }
  }

  async verifyEmail(token: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const usuId = await this.tokens.consume(sha256(token), 'EMAIL', m);
      if (usuId === null) throw invalidToken();
      await this.users.markVerified(usuId, m);
    });
  }

  async resendVerification(usuId: number): Promise<void> {
    const user = await this.users.findById(usuId);
    if (!user || user.verificado) return;
    const token = await this.dataSource.transaction((m) => this.createEmailToken(usuId, m));
    await this.sendVerification(user.correo, token);
  }

  /** No revela si el correo existe: el llamador responde `202` en todos los casos. */
  async requestRecovery(correo: string): Promise<void> {
    const account = await this.users.credentialsByEmail(correo);
    if (!account?.activo) return;
    const token = await this.dataSource.transaction((m) => this.createToken(account.id, 'RECUPERACION', this.config.recoveryTokenTtlSeconds, m));
    await this.deliver(() => this.mailer.sendPasswordRecovery(correo, `${this.config.portalUrl}/recuperar-clave?token=${token}`));
  }

  async confirmRecovery(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    await this.dataSource.transaction(async (m) => {
      const usuId = await this.tokens.consume(sha256(token), 'RECUPERACION', m);
      if (usuId === null) throw invalidToken();
      await this.users.setPassword(usuId, passwordHash, m);
      await this.sessions.revokeAll(usuId, m);
    });
  }
}
