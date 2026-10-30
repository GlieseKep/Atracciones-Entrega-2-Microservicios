import type { CiudadDto, ProvinciaDto, RegionArbolDto, ResolucionDto } from '../contract';
import type { CiudadRow, GeographyRows, ProvinciaRow, RegionRow } from '../persistence/location-repository';

/** Compara sin tildes ni mayúsculas: `banos`, `BAÑOS` y `Baños` son lo mismo. */
export const normalize = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Catálogo geográfico en memoria: son pocas filas y solo cambian con una migración, al reiniciar el servicio. */
export class Geography {
  private readonly regionsById: Map<number, RegionRow>;
  private readonly provincesById: Map<number, ProvinciaRow>;

  constructor(private readonly rows: GeographyRows) {
    this.regionsById = new Map(rows.regions.map((region) => [region.reg_id, region]));
    this.provincesById = new Map(rows.provinces.map((province) => [province.prov_id, province]));
  }

  private regionOf(province: ProvinciaRow): RegionRow {
    return this.regionsById.get(province.reg_id) as RegionRow;
  }

  private provinceDto(province: ProvinciaRow): ProvinciaDto {
    return {
      id: province.prov_id,
      codigo: province.prov_codigo,
      nombre: province.prov_nombre,
      region_codigo: this.regionOf(province).reg_codigo,
      activa: province.prov_activa,
    };
  }

  private cityDto(city: CiudadRow): CiudadDto {
    const province = this.provincesById.get(city.prov_id) as ProvinciaRow;
    const region = this.regionOf(province);
    return {
      id: city.ciu_id,
      codigo: city.ciu_codigo,
      nombre: city.ciu_nombre,
      activa: city.ciu_activa,
      descripcion: city.ciu_descripcion,
      imagen: city.ciu_imagen,
      provincia: { id: province.prov_id, nombre: province.prov_nombre },
      region: { codigo: region.reg_codigo, nombre: region.reg_nombre },
    };
  }

  private get activeProvinces() {
    return this.rows.provinces.filter((province) => province.prov_activa);
  }

  /** Ciudad activa dentro de una provincia activa. */
  private get activeCities() {
    return this.rows.cities.filter((city) => city.ciu_activa && this.provincesById.get(city.prov_id)?.prov_activa);
  }

  hasRegion(codigo: string): boolean {
    return this.rows.regions.some((region) => region.reg_codigo === codigo);
  }

  tree(): RegionArbolDto[] {
    const cities = this.activeCities;
    return this.rows.regions.map((region) => ({
      id: region.reg_id,
      codigo: region.reg_codigo,
      nombre: region.reg_nombre,
      provincias: this.activeProvinces
        .filter((province) => province.reg_id === region.reg_id)
        .map((province) => ({
          id: province.prov_id,
          codigo: province.prov_codigo,
          nombre: province.prov_nombre,
          ciudades: cities
            .filter((city) => city.prov_id === province.prov_id)
            .map((city) => ({ id: city.ciu_id, codigo: city.ciu_codigo, nombre: city.ciu_nombre })),
        })),
    }));
  }

  provinces(regionCodigo: string | null): ProvinciaDto[] {
    return this.activeProvinces
      .filter((province) => regionCodigo === null || this.regionOf(province).reg_codigo === regionCodigo)
      .map((province) => this.provinceDto(province));
  }

  province(id: number): ProvinciaDto | null {
    const province = this.provincesById.get(id);
    return province ? this.provinceDto(province) : null;
  }

  cities(filters: { q: string | null; provinciaId: number | null }): CiudadDto[] {
    const q = filters.q === null ? null : normalize(filters.q);
    return this.activeCities
      .filter((city) => filters.provinciaId === null || city.prov_id === filters.provinciaId)
      .filter((city) => q === null || normalize(city.ciu_nombre).includes(q))
      .map((city) => this.cityDto(city));
  }

  /** Incluye inactivas: otros servicios guardan datos históricos con ese ID. */
  city(id: number): CiudadDto | null {
    const city = this.rows.cities.find((row) => row.ciu_id === id);
    return city ? this.cityDto(city) : null;
  }

  citiesByIds(ids: number[]): CiudadDto[] {
    const wanted = new Set(ids);
    return this.rows.cities.filter((city) => wanted.has(city.ciu_id)).map((city) => this.cityDto(city));
  }

  /** Un nombre es primero una ciudad y, si no lo es, una provincia, que devuelve todas sus ciudades (Galápagos). */
  resolve(nombres: string[]): ResolucionDto {
    const result: ResolucionDto = { resueltas: [], no_encontrados: [] };
    const active = this.activeCities;
    for (const nombre of nombres) {
      const target = normalize(nombre);
      let cities = active.filter((city) => normalize(city.ciu_nombre) === target);
      if (cities.length === 0) {
        const province = this.activeProvinces.find((row) => normalize(row.prov_nombre) === target);
        cities = province ? active.filter((city) => city.prov_id === province.prov_id) : [];
      }
      if (cities.length === 0) result.no_encontrados.push(nombre);
      else result.resueltas.push({ nombre_enviado: nombre, ciudades: cities.map((city) => this.cityDto(city)) });
    }
    return result;
  }
}
