import { AppError, errorFields, type EsbClient, type Logger } from '@atracciones/platform';

interface City {
  id: number;
  nombre: string;
}

interface Resolution {
  resueltas: { nombre_enviado: string; ciudades: City[] }[];
  no_encontrados: string[];
}

const CACHE_TTL_MS = 10 * 60_000;

/** Ciudades de Location por el ESB. Si Location no responde, se siguen usando los nombres ya conocidos. */
export class Locations {
  private readonly cities = new Map<number, { nombre: string; loadedAt: number }>();

  constructor(
    private readonly esb: EsbClient,
    private readonly logger: Logger,
  ) {}

  /** Nombre por `ciu_id`. Un ID desconocido queda sin nombre mientras Location no responda. */
  async names(ids: number[]): Promise<Map<number, string>> {
    const now = Date.now();
    const unique = [...new Set(ids)];
    const stale = unique.filter((id) => (this.cities.get(id)?.loadedAt ?? 0) + CACHE_TTL_MS < now);
    if (stale.length > 0) {
      try {
        const found = await this.esb.call<City[]>('location', 'getCities', { ids: stale });
        for (const city of found) this.cities.set(city.id, { nombre: city.nombre, loadedAt: now });
      } catch (error) {
        this.logger.warn('Location no respondió; se usan los nombres en caché', errorFields(error));
      }
    }
    return new Map(unique.map((id) => [id, this.cities.get(id)?.nombre ?? '']));
  }

  /** `ciu_id` de un nombre de ciudad o provincia; lista vacía si no existe. */
  async resolve(nombre: string): Promise<number[]> {
    const result = await this.esb.call<Resolution>('location', 'resolveCities', { nombres: [nombre] });
    return result.resueltas.flatMap((item) => item.ciudades.map((city) => city.id));
  }

  /** Igual que `resolve`, pero un término libre no debe tumbar la búsqueda. */
  async tryResolve(nombre: string): Promise<number[]> {
    try {
      return await this.resolve(nombre);
    } catch (error) {
      this.logger.warn('Location no respondió; se busca solo por texto', errorFields(error));
      return [];
    }
  }

  async assertCity(id: number): Promise<void> {
    const found = await this.esb.call<City[]>('location', 'getCities', { ids: [id] });
    if (found.length === 0) throw AppError.unprocessable('CITY_NOT_FOUND', `No existe la ciudad ${id}.`, [{ name: 'ciu_id', reason: 'Ciudad desconocida.' }]);
  }

  async assertProvince(id: number): Promise<void> {
    await this.esb.call('location', 'getProvince', { id });
  }
}
