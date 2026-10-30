import {
  AppError,
  checkHealth,
  checkNodeHealth,
  createHttpService,
  createLogger,
  currentContext,
  requireServiceToken,
  type DatabaseSettings,
  type Logger,
} from '@atracciones/platform';
import { Router, type Express, type Request } from 'express';
import type { DataSource } from 'typeorm';
import { ApiClientService } from './application/api-client-service';
import { AuthService, type ClientInfo } from './application/auth-service';
import { CredentialValidator, type Authenticated } from './application/credential-validator';
import {
  parseActivo,
  parseClienteApi,
  parseCorreo,
  parseId,
  parseIds,
  parseLogin,
  parsePasswordChange,
  parseProfilePatch,
  parseRecoveryConfirm,
  parseRegistro,
  parseRol,
  parseSecret,
  parseUserFilters,
} from './application/input';
import { LogMailer, type Mailer } from './application/mailer';
import { UserService } from './application/user-service';
import { VerificationService } from './application/verification-service';
import { IDENTITY_BASE_PATH } from './integration/esb-routes';
import { ApiClientRepository } from './persistence/api-client-repository';
import { SessionRepository } from './persistence/session-repository';
import { TokenRepository } from './persistence/token-repository';
import { UserRepository } from './persistence/user-repository';

export interface MsIdentityConfig {
  port: number;
  database: DatabaseSettings;
  /** Firma de los JWT: solo la tiene Identity. */
  jwtSecret: string;
  /** Verifica el principal que reenvía el Gateway. */
  internalTokenSecret: string;
  /** Cabecera `X-Service-Token` de las rutas `/internal/**`. */
  serviceToken: string;
  basePath: string;
  portalUrl: string;
  nodeId: string;
  nodeCode: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  emailTokenTtlSeconds: number;
  recoveryTokenTtlSeconds: number;
}

export function readMsIdentityConfig(env: NodeJS.ProcessEnv = process.env): MsIdentityConfig {
  return {
    port: Number(env.PORT ?? 4018),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/ms_identity', ssl: env.DATABASE_SSL === 'true' },
    jwtSecret: env.JWT_SECRET ?? '',
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
    serviceToken: env.SERVICE_TOKEN ?? '',
    basePath: env.BASE_PATH ?? IDENTITY_BASE_PATH,
    portalUrl: (env.PORTAL_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    nodeId: env.NODE_ID ?? 'node-dilan-identity-01',
    nodeCode: env.NODE_CODE ?? 'DILAN_IDENTITY',
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
    emailTokenTtlSeconds: 24 * 60 * 60,
    recoveryTokenTtlSeconds: 60 * 60,
  };
}

export interface MsIdentityDependencies {
  logger?: Logger;
  mailer?: Mailer;
}

export interface MsIdentityService {
  app: Express;
  users: UserService;
}

const VERSION = '1.0.0';

const clientInfo = (req: Request): ClientInfo => ({
  ip: (req.get('x-forwarded-for')?.split(',')[0].trim() || req.ip || '').slice(0, 45) || null,
  userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
});

/**
 * Identity & Access Service (REST, contrato `Plan/ms_identity/ms_identity-openapi.yaml`): cuentas, roles, sesiones,
 * verificación del correo, clientes API y validación de credenciales para el API Gateway.
 */
export function createMsIdentityService(config: MsIdentityConfig, dataSource: DataSource, deps: MsIdentityDependencies = {}): MsIdentityService {
  const logger = deps.logger ?? createLogger('ms-identity');
  const userRepository = new UserRepository(dataSource);
  const sessions = new SessionRepository(dataSource);
  const apiClientRepository = new ApiClientRepository(dataSource);
  const verification = new VerificationService(dataSource, userRepository, sessions, new TokenRepository(dataSource), deps.mailer ?? new LogMailer(logger), config, logger);
  const auth = new AuthService(dataSource, userRepository, sessions, verification, config);
  const users = new UserService(dataSource, userRepository, sessions);
  const apiClients = new ApiClientService(apiClientRepository);
  const credentials = new CredentialValidator(userRepository, sessions, apiClientRepository, config.jwtSecret, config.internalTokenSecret);

  /** Bearer del usuario o, detrás del Gateway y el ESB, el principal interno ya validado. */
  async function authenticate(req: Request): Promise<Authenticated> {
    const bearer = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1];
    if (bearer) return credentials.validateToken(bearer);
    const principalToken = currentContext()?.principalToken;
    if (principalToken) return credentials.validateInternalPrincipal(principalToken);
    throw AppError.unauthorized();
  }

  async function requireAdmin(req: Request): Promise<Authenticated> {
    const authenticated = await authenticate(req);
    if (!authenticated.principal.roles.includes('ADMIN')) throw AppError.forbidden('Esta operación requiere el rol ADMIN.');
    return authenticated;
  }

  const internal = requireServiceToken(config.serviceToken);

  const api = Router();

  api.get('/health', async (_req, res) => {
    const health = await checkNodeHealth('ms-identity', dataSource, { nodeId: config.nodeId, nodeCode: config.nodeCode, version: VERSION });
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  // Autenticación --------------------------------------------------------------

  api.post('/auth/registro', async (req, res) => {
    res.status(201).json(await auth.register(parseRegistro(req.body)));
  });

  api.post('/auth/login', async (req, res) => {
    const { correo, password } = parseLogin(req.body);
    res.json(await auth.login(correo, password, clientInfo(req)));
  });

  api.post('/auth/refresh', async (req, res) => {
    res.json(await auth.refresh(parseSecret(req.body, 'refresh_token'), clientInfo(req)));
  });

  api.post('/auth/logout', async (req, res) => {
    const { sesId } = await authenticate(req);
    if (!sesId) throw AppError.unauthorized('Cerrar la sesión requiere el JWT de esa sesión.');
    await auth.logout(sesId);
    res.status(204).end();
  });

  api.post('/auth/verificacion-correo', async (req, res) => {
    await verification.verifyEmail(parseSecret(req.body, 'token'));
    res.status(204).end();
  });

  api.post('/auth/verificacion-correo/reenvio', async (req, res) => {
    const { principal } = await authenticate(req);
    await verification.resendVerification(principal.id);
    res.status(202).end();
  });

  api.post('/auth/recuperacion', async (req, res) => {
    await verification.requestRecovery(parseCorreo(req.body));
    res.status(202).end();
  });

  api.post('/auth/recuperacion/confirmar', async (req, res) => {
    const { token, password } = parseRecoveryConfirm(req.body);
    await verification.confirmRecovery(token, password);
    res.status(204).end();
  });

  // Perfil ---------------------------------------------------------------------

  api.get('/usuarios/me', async (req, res) => {
    const { principal } = await authenticate(req);
    res.json(await users.get(principal.id));
  });

  api.patch('/usuarios/me', async (req, res) => {
    const { principal } = await authenticate(req);
    res.json(await users.updateProfile(principal.id, parseProfilePatch(req.body)));
  });

  api.put('/usuarios/me/password', async (req, res) => {
    const { principal, sesId } = await authenticate(req);
    const { actual, nuevo } = parsePasswordChange(req.body);
    await auth.changePassword(principal.id, sesId, actual, nuevo);
    res.status(204).end();
  });

  // Usuarios y roles (ADMIN) ---------------------------------------------------

  api.get('/usuarios', async (req, res) => {
    await requireAdmin(req);
    res.json(await users.list(parseUserFilters(req.query as Record<string, unknown>)));
  });

  api.get('/usuarios/:id', async (req, res) => {
    await requireAdmin(req);
    res.json(await users.get(parseId(req.params.id)));
  });

  api.put('/usuarios/:id/activo', async (req, res) => {
    const { principal } = await requireAdmin(req);
    res.json(await users.setActive(parseId(req.params.id), parseActivo(req.body), principal.id));
  });

  api.post('/usuarios/:id/roles', async (req, res) => {
    const { principal } = await requireAdmin(req);
    res.json(await users.assignRole(parseId(req.params.id), parseRol((req.body as { rol?: unknown } | undefined)?.rol), principal.id));
  });

  api.delete('/usuarios/:id/roles/:rol', async (req, res) => {
    await requireAdmin(req);
    res.json(await users.removeRole(parseId(req.params.id), parseRol(req.params.rol)));
  });

  api.get('/roles', async (req, res) => {
    await requireAdmin(req);
    res.json(await userRepository.listRoles());
  });

  // Clientes API (ADMIN) -------------------------------------------------------

  api.get('/clientes-api', async (req, res) => {
    await requireAdmin(req);
    res.json(await apiClients.list());
  });

  api.post('/clientes-api', async (req, res) => {
    await requireAdmin(req);
    const { codigo, nombre } = parseClienteApi(req.body);
    res.status(201).json(await apiClients.create(codigo, nombre));
  });

  api.put('/clientes-api/:id/activo', async (req, res) => {
    await requireAdmin(req);
    res.json(await apiClients.setActive(parseId(req.params.id), parseActivo(req.body)));
  });

  // Validación para el Gateway y otros servicios -------------------------------

  api.post('/internal/tokens/validar', internal, async (req, res) => {
    const { principal } = await credentials.validateToken(parseSecret(req.body, 'token'));
    res.json(principal);
  });

  api.post('/internal/api-keys/validar', internal, async (req, res) => {
    res.json(await credentials.validateApiKey(parseSecret(req.body, 'api_key')));
  });

  api.post('/internal/usuarios/lote', internal, async (req, res) => {
    res.json(await userRepository.summaries(parseIds(req.body)));
  });

  const app = createHttpService({
    service: 'ms-identity',
    logger,
    health: () => checkHealth('ms-identity', dataSource),
    routes: (express) => express.use(config.basePath, api),
  });
  return { app, users };
}
