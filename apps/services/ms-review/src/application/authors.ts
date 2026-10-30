import { asService, type EsbClient, type Logger } from '@atracciones/platform';

/** Nombre que se muestra si Identity no responde o el usuario ya no existe. */
export const FALLBACK_AUTHOR = 'Viajero verificado';

/** Nombres completos de usuarios de Identity por id. Los que no encuentra no vienen en el mapa. */
export interface AuthorDirectory {
  names(userIds: string[]): Promise<Map<string, string>>;
}

/** "María Fernanda Andrade" → "María A.": nombre y la inicial del último apellido. */
export function shortName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return FALLBACK_AUTHOR;
  if (words.length === 1) return words[0];
  return `${words[0]} ${words[words.length - 1][0].toUpperCase()}.`;
}

/**
 * `identity.getUsers` por el ESB con la cuenta de servicio de Review (la ruta es de administración). Si falla, se
 * registra y se devuelve un mapa vacío: las reseñas se muestran igual, con `FALLBACK_AUTHOR`.
 */
export function esbAuthorDirectory(esb: EsbClient, internalTokenSecret: string, logger: Logger): AuthorDirectory {
  return {
    async names(userIds) {
      const ids = [...new Set(userIds)];
      if (!ids.length) return new Map();
      try {
        const users = await asService('review', internalTokenSecret, () =>
          esb.call<{ id: string; nombre_completo: string }[]>('identity', 'getUsers', { ids }, { timeoutMs: 1500 }));
        return new Map(users.map((u) => [u.id, u.nombre_completo]));
      } catch (error) {
        logger.warn('no se pudieron leer los nombres de los autores en Identity', { error: String(error) });
        return new Map();
      }
    },
  };
}
