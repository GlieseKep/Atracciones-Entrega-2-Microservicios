import { EsbClient, signInternalPrincipal, type Principal } from '@atracciones/platform';
import { createPartnerApi, type PartnerApi } from '../src/app';
import type { PartnerApiConfig } from '../src/config';

/** Utilidades de prueba de la Partner API (fuera de src: no entra en el build). */
export const SECRET = 'secreto-interno-de-pruebas-con-mas-de-32-caracteres';
export const SOCIO: Principal = { tipo: 'API_CLIENTE', id: '9', scopes: ['attractions:read', 'attractions:book', 'attractions:cancel', 'attractions:checkin'], nombre: 'Booking' };
export const USUARIO: Principal = { tipo: 'USUARIO', id: '3', scopes: ['CLIENTE'], nombre: 'Ana' };
export const IDEM = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

export function testConfig(overrides: Partial<PartnerApiConfig> = {}): PartnerApiConfig {
  return {
    port: 0,
    esbUrl: 'http://esb.invalid',
    redisUrl: null,
    internalTokenSecret: SECRET,
    validateResponses: false,
    timeZone: 'America/Guayaquil',
    node: { id: 'node-test', code: 'TEST', publicBaseUrl: 'http://localhost/api/v3', version: '3.0.0' },
    health: { critical: ['catalog', 'booking'], optional: ['refund'], cacheMs: 0, timeoutMs: 100 },
    ...overrides,
  };
}

/**
 * Partner API real con el ESB reemplazado por un spy (`EsbClient.prototype.call`). `respond` decide la respuesta por
 * servicio y operación; lo que lanza se propaga como lo haría un error del ESB.
 */
export function partnerApiWithEsb(respond: (service: string, operation: string, input: Record<string, unknown>) => unknown, config = testConfig()): { api: PartnerApi; esb: jest.SpyInstance } {
  process.env.LOG_SILENT = 'true';
  const esb = jest.spyOn(EsbClient.prototype, 'call').mockImplementation(async (service: string, operation: string, input: object = {}) => respond(service, operation, input as Record<string, unknown>) as never);
  return { api: sharedApi(config), esb };
}

/**
 * Una Partner API por archivo de prueba y configuración: crearla compila el validador OpenAPI del contrato, que es lo
 * más costoso de estas pruebas; con la máquina cargada, crear una por caso superaba el plazo de 60 s (prueba
 * intermitente, plan §2.2). El spy del ESB está en el prototipo, así que vale para la instancia reutilizada. La caché de
 * lectura se vacía en cada caso para que ningún caso dependa de otro.
 */
const apis = new Map<string, PartnerApi>();
function sharedApi(config: PartnerApiConfig): PartnerApi {
  const key = JSON.stringify(config);
  let api = apis.get(key);
  if (!api) {
    api = createPartnerApi(config);
    apis.set(key, api);
  }
  void api.cache.deletePrefix('');
  return api;
}

export const principalHeader = (principal: Principal) => signInternalPrincipal(principal, SECRET);

/**
 * Cabeceras de una petición autenticada tal como llega desde el Gateway: el principal interno firmado y la credencial
 * original (el validador del contrato exige que la operación traiga `X-API-Key` o `Authorization`).
 */
export async function authHeaders(principal: Principal): Promise<Record<string, string>> {
  const credential: Record<string, string> = principal.tipo === 'API_CLIENTE' ? { 'X-API-Key': 'clave-socio' } : { Authorization: 'Bearer jwt-usuario' };
  return { 'x-internal-principal': await principalHeader(principal), ...credential };
}

export const validReservation = (overrides: Record<string, unknown> = {}) => ({
  attraction_id: 'PRhu4UBTWPBC',
  slot_id: 'slot-20261125-1030',
  date: '2026-11-25',
  time: '10:30:00',
  adult_count: 2,
  customer: { full_name: 'Ana Pérez', email: 'ana@correo.com', phone: '0991234567', document_type: 'CEDULA', document_id: '1710034065' },
  payment_method: { method: 'CREDIT_CARD' },
  ...overrides,
});
