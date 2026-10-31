/** Configuración pública del frontend (se fija al compilar). Nunca contiene secretos. */

export type CatalogSource = 'auto' | 'api' | 'demo';

function read(name: keyof ImportMetaEnv, fallback = ''): string {
  const value = import.meta.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function catalogSource(): CatalogSource {
  const value = read('VITE_CATALOG_SOURCE', 'auto');
  return value === 'api' || value === 'demo' ? value : 'auto';
}

const origin = (value: string) => value.replace(/\/+$/, '');

export const env = {
  /** URL del API sin el prefijo; el cliente añade `/api/v1`. */
  apiBaseUrl: `${origin(read('VITE_API_URL', 'http://localhost:5276'))}/api/v1`,
  /** Servicio de autenticación (registro e inicio de sesión). */
  authUrl: origin(read('VITE_AUTH_URL', 'http://localhost:5280')),
  catalogSource: catalogSource(),
} as const;
