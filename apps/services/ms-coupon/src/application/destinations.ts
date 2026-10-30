import { AppError, type EsbClient, type Logger } from '@atracciones/platform';

/** Ciudad destino. `destinos_habilitados` llega y sale como nombres; en la base se guarda su `ciu_id`. */
export interface City {
  id: number;
  name: string;
}

/** Catálogo de ciudades (Location; mientras no exista, las ciudades de Catalog). */
export interface CityDirectory {
  cities(): Promise<City[]>;
}

/** Nombre comparable: sin tildes, sin espacios sobrantes y en minúsculas (`Baños` = `banos`). */
export const normalizeName = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** IDs de los nombres recibidos (sin repetir) y los nombres que no corresponden a ninguna ciudad. */
export function resolveNames(names: string[], cities: City[]): { ids: number[]; missing: string[] } {
  const byName = new Map<string, number>();
  // Con nombres repetidos en provincias distintas gana el id menor (resultado estable).
  for (const c of [...cities].sort((a, b) => a.id - b.id)) if (!byName.has(normalizeName(c.name))) byName.set(normalizeName(c.name), c.id);
  const ids = new Set<number>();
  const missing: string[] = [];
  for (const name of names) {
    const id = byName.get(normalizeName(name));
    if (id === undefined) missing.push(name);
    else ids.add(id);
  }
  return { ids: [...ids], missing };
}

/** Nombres de los destinos guardados, en orden alfabético. Un id que ya no existe se omite. */
export function namesFor(ids: number[], cities: City[]): { names: string[]; unknown: number[] } {
  const byId = new Map(cities.map((c) => [c.id, c.name]));
  const names: string[] = [];
  const unknown: number[] = [];
  for (const id of ids) {
    const name = byId.get(id);
    if (name === undefined) unknown.push(id);
    else names.push(name);
  }
  return { names: names.sort((a, b) => a.localeCompare(b, 'es')), unknown };
}

/**
 * Ciudades de Catalog (`catalog.getReferences`) por el ESB, en caché por `ttlMs`. Si Catalog no responde se sigue
 * usando la última lista conocida, para que el acuerdo con Booking se pueda leer aunque Catalog esté caído.
 */
export function esbCityDirectory(esb: EsbClient, logger: Logger, ttlMs = 10 * 60_000): CityDirectory {
  let cached: { cities: City[]; at: number } | null = null;
  return {
    async cities() {
      if (cached && Date.now() - cached.at < ttlMs) return cached.cities;
      try {
        const refs = await esb.call<{ ciudades?: { id: number | string; nombre: string }[] }>('catalog', 'getReferences', {}, { timeoutMs: 2000 });
        cached = { cities: (refs.ciudades ?? []).map((c) => ({ id: Number(c.id), name: c.nombre })), at: Date.now() };
        return cached.cities;
      } catch (error) {
        if (cached) {
          logger.warn('Catalog no respondió; se usan las ciudades en caché', { error: String(error) });
          return cached.cities;
        }
        // Los códigos del contrato para el acuerdo no incluyen 503: se informa como error interno.
        throw AppError.internal('No se pudo consultar el catálogo de ciudades.');
      }
    },
  };
}
