import { AppError, verifyInternalPrincipal } from '@atracciones/platform';
import type { PrincipalDto } from '../contract';
import type { ApiClientRepository } from '../persistence/api-client-repository';
import type { SessionRepository } from '../persistence/session-repository';
import type { UserRepository } from '../persistence/user-repository';
import { sha256, verifyAccessToken } from './tokens';

/** Principal autenticado y la sesión de su JWT (`null` si llegó como principal interno del Gateway). */
export interface Authenticated {
  principal: PrincipalDto;
  sesId: string | null;
}

const invalid = () => AppError.unauthorized('La credencial no es válida, venció o fue revocada.');

export class CredentialValidator {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly apiClients: ApiClientRepository,
    private readonly jwtSecret: string,
    private readonly internalTokenSecret: string,
  ) {}

  /** Firma, expiración, sesión no revocada y usuario activo. Los roles se leen de la base: el JWT puede estar atrasado. */
  async validateToken(token: string): Promise<Authenticated> {
    const claims = await verifyAccessToken(token, this.jwtSecret);
    if (!claims || !(await this.sessions.isActive(claims.sesId))) throw invalid();
    return { principal: await this.activeUser(claims.usuId), sesId: claims.sesId };
  }

  /** SHA-256, `cla_activo` y `cla_ultimo_uso`. */
  async validateApiKey(apiKey: string): Promise<PrincipalDto> {
    const client = await this.apiClients.useKey(sha256(apiKey));
    if (!client) throw invalid();
    return { tipo: 'CLIENTE_API', id: client.id, nombre: client.nombre, roles: [] };
  }

  /** Principal que el Gateway validó y reenvía por el ESB. */
  async validateInternalPrincipal(token: string): Promise<Authenticated> {
    const principal = await verifyInternalPrincipal(token, this.internalTokenSecret);
    const usuId = Number(principal.id);
    if (principal.tipo !== 'USUARIO' || !Number.isSafeInteger(usuId)) throw AppError.forbidden('Esta operación es solo para usuarios.');
    return { principal: await this.activeUser(usuId), sesId: null };
  }

  private async activeUser(usuId: number): Promise<PrincipalDto> {
    const user = await this.users.findById(usuId);
    if (!user?.activo) throw invalid();
    return { tipo: 'USUARIO', id: user.id, nombre: `${user.nombre} ${user.apellido}`, roles: user.roles };
  }
}
