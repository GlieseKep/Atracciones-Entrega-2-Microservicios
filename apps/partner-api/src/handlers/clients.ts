import { AppError, hasRole, type EsbClient } from '@atracciones/platform';
import { Router, type Request, type Response } from 'express';
import type { ContractRequest } from '../request';

interface ClienteResponse {
  client_id: string;
  nombre: string;
  email: string;
  identificacion: string;
  telefono?: string | null;
  /** Solo para decidir entre 201 y 200; no se devuelve a Booking. */
  creado?: boolean;
}

/** Un socio con `X-API-Key` (y el scope) o un usuario `ADMIN`. */
function requirePartnerOrAdmin(req: Request, scope: 'clients:read' | 'clients:write'): void {
  const principal = (req as ContractRequest).principal ?? null;
  if (!principal) throw AppError.unauthorized();
  if (principal.tipo === 'API_CLIENTE' && principal.scopes.includes(scope)) return;
  if (principal.tipo === 'USUARIO' && hasRole(principal, 'ADMIN')) return;
  throw AppError.forbidden('Los clientes solo los consulta o registra un socio con X-API-Key o un ADMIN.');
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/**
 * `GET/POST /api/v3/clientes`: módulo de clientes que pidió Booking (no está en `atracciones-openapi-v3.yaml`, por eso
 * se registra antes del validador del contrato). Identity guarda al turista en `cliente_api`, sin duplicarlo.
 */
export function clientRoutes(esb: EsbClient): Router {
  const router = Router();

  /** 200 con el cliente o 404 si no existe; 409 si el correo y la identificación son de clientes distintos. */
  router.get('/clientes', async (req: Request, res: Response) => {
    requirePartnerOrAdmin(req, 'clients:read');
    const query: Record<string, string> = {};
    const email = text(req.query.email);
    const identificacion = text(req.query.identificacion);
    if (email !== undefined) query.email = email;
    if (identificacion !== undefined) query.identificacion = identificacion;
    const { client_id, nombre, email: correo, identificacion: doc } = await esb.call<ClienteResponse>('identity', 'findClient', query);
    res.json({ client_id, nombre, email: correo, identificacion: doc });
  });

  /** 201 `{ client_id }` si es nuevo; 200 con el mismo `client_id` si ya existía (nunca se duplica). */
  router.post('/clientes', async (req: Request, res: Response) => {
    requirePartnerOrAdmin(req, 'clients:write');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cliente = await esb.call<ClienteResponse>('identity', 'createClient', {
      nombre: body.nombre,
      email: body.email,
      identificacion: body.identificacion,
      telefono: body.telefono,
    });
    res.status(cliente.creado ? 201 : 200).json({ client_id: cliente.client_id });
  });

  return router;
}
