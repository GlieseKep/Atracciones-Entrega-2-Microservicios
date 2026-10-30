import { checkHealth, createHttpService, optionalText, paging, requireAdmin, requirePrincipal, type DatabaseSettings } from '@atracciones/platform';
import type { Express } from 'express';
import type { DataSource } from 'typeorm';
import { AccountService } from './application/accounts';
import { TokenIssuer, type TokenSettings } from './application/tokens';
import { UserService } from './application/users';
import { IdentityRepository } from './persistence/repositories';

export interface IdentityConfig {
  port: number;
  database: DatabaseSettings;
  tokens: TokenSettings;
  /** Clave privada RS256 en PEM (PKCS#8). Sin ella se genera una efímera: solo para desarrollo y pruebas. */
  privateKeyPem: string | null;
  /** Verifica el principal interno de las rutas de perfil y administración (llegan por GraphQL → ESB). */
  internalTokenSecret: string;
}

export function readIdentityConfig(env: NodeJS.ProcessEnv = process.env): IdentityConfig {
  return {
    port: Number(env.PORT ?? 4001),
    database: { url: env.DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/identity_db', ssl: env.DATABASE_SSL === 'true' },
    tokens: {
      issuer: env.JWT_ISSUER ?? 'atracciones-identity',
      audience: env.JWT_AUDIENCE ?? 'atracciones-api',
      ttlSeconds: Number(env.JWT_TTL_SECONDS ?? 3600),
    },
    privateKeyPem: env.JWT_PRIVATE_KEY_PEM?.replace(/\\n/g, '\n') ?? null,
    internalTokenSecret: env.INTERNAL_TOKEN_SECRET ?? '',
  };
}

export interface IdentityService {
  app: Express;
  accounts: AccountService;
  users: UserService;
  tokens: TokenIssuer;
}

/** Identity & User Service (REST, plan §3.1). */
export async function createIdentityService(config: IdentityConfig, dataSource: DataSource): Promise<IdentityService> {
  const tokens = await TokenIssuer.create(config.tokens, config.privateKeyPem);
  const repository = new IdentityRepository(dataSource);
  const accounts = new AccountService(repository, tokens);
  const users = new UserService(repository);
  const me = () => requirePrincipal(config.internalTokenSecret);
  const admin = () => requireAdmin(config.internalTokenSecret);
  const app = createHttpService({
    service: 'identity',
    health: () => checkHealth('identity', dataSource),
    routes: (a) => {
      a.post('/auth/register', async (req, res) => {
        res.status(201).json(await accounts.register(req.body ?? {}));
      });
      a.post('/auth/login', async (req, res) => {
        res.json(await accounts.login(req.body ?? {}));
      });
      a.get('/.well-known/jwks.json', (_req, res) => {
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.json(tokens.jwks());
      });
      // Interno: lo invoca el Gateway (a través del ESB) para autenticar la cabecera X-API-Key.
      a.post('/internal/api-keys/verify', async (req, res) => {
        res.json(await accounts.verifyApiKey(req.body?.api_key));
      });

      // Perfil del usuario autenticado (portal).
      a.get('/usuarios/me', async (_req, res) => {
        res.json(await users.profile((await me()).id));
      });
      a.put('/usuarios/me', async (req, res) => {
        res.json(await users.updateProfile((await me()).id, req.body ?? {}));
      });
      a.get('/usuarios/me/facturacion', async (_req, res) => {
        res.json({ facturacion: await users.billing((await me()).id) });
      });
      a.put('/usuarios/me/facturacion', async (req, res) => {
        res.json(await users.saveBilling((await me()).id, req.body ?? {}));
      });

      // Administración (scope attractions:write).
      a.get('/usuarios', async (req, res) => {
        await admin();
        const q = req.query;
        res.json(await users.list({ search: optionalText(q.search), estado: optionalText(q.estado), rol: optionalText(q.rol), ...paging(q) }));
      });
      a.post('/usuarios/lote', async (req, res) => {
        await admin();
        res.json(await users.batch(req.body?.ids));
      });
      a.get('/usuarios/estadisticas', async (_req, res) => {
        await admin();
        res.json(await users.stats());
      });
      a.put('/usuarios/:id/estado', async (req, res) => {
        const actor = await admin();
        res.json(await users.setStatus(req.params.id, req.body?.estado, actor.id));
      });
      a.post('/usuarios/:id/roles', async (req, res) => {
        const actor = await admin();
        res.json(await users.grantRole(req.params.id, req.body ?? {}, actor.id));
      });
      a.delete('/usuarios/:id/roles/:rol', async (req, res) => {
        const actor = await admin();
        res.json(await users.revokeRole(req.params.id, req.params.rol, actor.id));
      });
      a.get('/roles', async (_req, res) => {
        await admin();
        res.json(await users.roles());
      });
    },
  });
  return { app, accounts, users, tokens };
}
