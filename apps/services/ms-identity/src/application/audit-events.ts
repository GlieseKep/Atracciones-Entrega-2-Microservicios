import { recordEvent } from '@atracciones/platform';
import type { EntityManager } from 'typeorm';

/**
 * Eventos de Identity para la bitácora (`Plan/PLAN_BITACORA_IDENTITY.md`). Se guardan en `outbox` en la misma
 * transacción que el cambio y los publica el relay. ms-audit toma `data.usu_id` como quien hizo el cambio y el
 * `subject` (`agregado_id`) como la cuenta afectada. Nunca llevan contraseñas, tokens ni API keys.
 */
export type IdentityEvent =
  | 'ROL_ASIGNADO'
  | 'ROL_REVOCADO'
  | 'USUARIO_DESACTIVADO'
  | 'USUARIO_REACTIVADO'
  | 'ADMIN_INICIAL_CREADO'
  | 'CLIENTE_API_CREADO'
  | 'CLIENTE_API_ACTIVADO'
  | 'CLIENTE_API_DESACTIVADO';

/** Cambio sobre una cuenta de usuario. `actorId` es `null` si no lo hizo un administrador (p. ej. `create-admin`). */
export function recordUserEvent(
  m: EntityManager,
  tipoEvento: IdentityEvent,
  actorId: number | null,
  user: { id: number; correo: string },
  extra: Record<string, unknown> = {},
): Promise<string> {
  return recordEvent(m, {
    tipoEvento,
    agregadoId: String(user.id),
    payload: { usu_id: actorId, usuario_id: user.id, correo: user.correo, ...extra },
  });
}

/** Cambio sobre un socio (`cliente_api` de tipo `SOCIO`). */
export function recordApiClientEvent(m: EntityManager, tipoEvento: IdentityEvent, actorId: number, client: { id: number; codigo: string }): Promise<string> {
  return recordEvent(m, {
    tipoEvento,
    agregadoId: String(client.id),
    payload: { usu_id: actorId, cla_id: client.id, codigo: client.codigo },
  });
}
