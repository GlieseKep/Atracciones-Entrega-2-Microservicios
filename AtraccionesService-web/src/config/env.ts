/** Configuración pública del frontend (se fija al compilar). Nunca contiene secretos. */

function read(name: keyof ImportMetaEnv, fallback = ''): string {
  const value = import.meta.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

const origin = read('VITE_API_URL', 'http://localhost:3000').replace(/\/+$/, '');

export const env = {
  /** URL del Gateway sin prefijo. */
  apiOrigin: origin,
  /** REST del Gateway: sesión (`/auth`) y contrato público de atracciones. */
  apiBaseUrl: `${origin}/api/v3`,
  /** GraphQL del portal: perfil, compras, pedidos, facturación, reseñas y contacto. */
  graphqlUrl: `${origin}/graphql`,
} as const;
