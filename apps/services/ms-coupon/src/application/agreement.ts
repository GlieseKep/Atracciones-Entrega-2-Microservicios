import { AppError, errorFields, todayIn, type EsbClient, type InvalidParam, type Logger } from '@atracciones/platform';
import type { AgreementInput, PromocionesContratoResponse } from '../contract';
import type { AgreementRepository } from '../persistence/agreement-repository';
import { isDate } from './coupon-input';

interface City {
  id: number;
  nombre: string;
}

export function parseAgreement(body: unknown): AgreementInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: InvalidParam[] = [];
  if (typeof b.permite_promociones !== 'boolean') errors.push({ name: 'permite_promociones', reason: 'Debe ser booleano.' });
  const porcentaje = b.porcentaje_descuento_maximo;
  if (typeof porcentaje !== 'number' || !Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 50) {
    errors.push({ name: 'porcentaje_descuento_maximo', reason: 'Debe estar entre 0 y 50.' });
  }
  const destinos = b.destinos_habilitados;
  if (destinos !== undefined && (!Array.isArray(destinos) || destinos.some((item) => typeof item !== 'string' || item.trim() === ''))) {
    errors.push({ name: 'destinos_habilitados', reason: 'Debe ser una lista de nombres.' });
  }
  if (b.vigencia_hasta !== undefined && !isDate(b.vigencia_hasta)) errors.push({ name: 'vigencia_hasta', reason: 'Debe ser una fecha YYYY-MM-DD.' });
  const text = (value: unknown, name: string, max: number): string | null | undefined => {
    if (value === undefined || value === null) return value as undefined | null;
    if (typeof value !== 'string' || value.length > max) errors.push({ name, reason: `Debe ser texto de hasta ${max} caracteres.` });
    return value as string;
  };
  const contacto = (b.contacto_comercial ?? {}) as Record<string, unknown>;
  const input: AgreementInput = {
    // Sin promociones no hay descuento.
    permite: b.permite_promociones as boolean,
    porcentaje: b.permite_promociones === true ? (porcentaje as number) : 0,
    destinos: destinos as string[] | undefined,
    vigenciaHasta: b.vigencia_hasta as string | undefined,
    condiciones: text(b.condiciones_combo, 'condiciones_combo', 500),
    contactoNombre: text(contacto.nombre, 'contacto_comercial.nombre', 120),
    contactoCorreo: text(contacto.email, 'contacto_comercial.email', 160),
    contactoTelefono: text(contacto.telefono, 'contacto_comercial.telefono', 20),
  };
  if (errors.length > 0) throw AppError.validation('El cuestionario tiene campos inválidos.', errors);
  return input;
}

/** Acuerdo B2B. Los destinos se guardan como `ciu_id` y el contrato los usa por nombre. */
export class AgreementService {
  private readonly names = new Map<number, string>();

  constructor(
    private readonly agreements: AgreementRepository,
    private readonly esb: EsbClient,
    private readonly logger: Logger,
  ) {}

  /** Si Location no responde, el `GET` sigue con los nombres ya conocidos. */
  private async cityNames(ids: number[]): Promise<string[]> {
    const missing = ids.filter((id) => !this.names.has(id));
    if (missing.length > 0) {
      try {
        const cities = await this.esb.call<City[]>('location', 'getCities', { ids: missing });
        for (const city of cities) this.names.set(city.id, city.nombre);
      } catch (error) {
        this.logger.warn('Location no respondió; se usan los nombres en caché', errorFields(error));
      }
    }
    return ids.flatMap((id) => this.names.get(id) ?? []).sort((a, b) => a.localeCompare(b, 'es'));
  }

  async get(): Promise<PromocionesContratoResponse> {
    const { row, cityIds } = await this.agreements.get();
    return {
      proveedor_id: row.apr_proveedor_codigo,
      ...(row.apr_nombre_comercial ? { nombre_comercial: row.apr_nombre_comercial } : {}),
      permite_promociones: row.apr_permite_promociones,
      porcentaje_descuento_maximo: Number(row.apr_porcentaje_descuento_max),
      destinos_habilitados: await this.cityNames(cityIds),
      fecha_acuerdo: row.apr_fecha_acuerdo,
      vigencia_hasta: row.apr_vigencia_hasta,
      ...(row.apr_condiciones_combo ? { condiciones_combo: row.apr_condiciones_combo } : {}),
    };
  }

  /** Una provincia como Galápagos se guarda como sus ciudades. Un nombre desconocido responde `400`. */
  private async resolveDestinations(destinos: string[]): Promise<number[]> {
    if (destinos.length === 0) return [];
    const result = await this.esb.call<{ resueltas: { ciudades: City[] }[]; no_encontrados: string[] }>('location', 'resolveCities', { nombres: destinos });
    if (result.no_encontrados.length > 0) {
      throw AppError.validation(
        `Destinos desconocidos: ${result.no_encontrados.join(', ')}.`,
        result.no_encontrados.map((nombre) => ({ name: 'destinos_habilitados', reason: `Destino desconocido: ${nombre}.` })),
        'DESTINATION_NOT_FOUND',
      );
    }
    const cities = result.resueltas.flatMap((item) => item.ciudades);
    for (const city of cities) this.names.set(city.id, city.nombre);
    return [...new Set(cities.map((city) => city.id))];
  }

  async update(input: AgreementInput): Promise<PromocionesContratoResponse> {
    const today = todayIn();
    const { row } = await this.agreements.get();
    if ((input.vigenciaHasta ?? row.apr_vigencia_hasta) < today) {
      throw AppError.validation('vigencia_hasta no puede ser anterior a la fecha del acuerdo.', [{ name: 'vigencia_hasta', reason: 'Debe ser hoy o posterior.' }]);
    }
    const cityIds = input.destinos === undefined ? undefined : await this.resolveDestinations(input.destinos);
    await this.agreements.update(row.apr_id, input, today, cityIds);
    return this.get();
  }
}
