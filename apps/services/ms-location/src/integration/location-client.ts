import type { EsbClient } from '@atracciones/platform';
import type { CiudadDto, ProvinciaDto, RegionArbolDto, ResolucionDto } from '../contract';
import type { LocationOperation } from './esb-routes';

/**
 * Cliente de Location a través del ESB (operaciones de `MS_LOCATION_ROUTES`).
 *
 * - Catalog: `getCities` para los nombres y `resolveCities` para el filtro `ciudad`.
 * - Coupon: `resolveCities` y `getCities` para `destinos_habilitados`.
 * - GraphQL: listas del portal y del panel.
 */
export class LocationClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'location',
  ) {}

  private call<T>(operation: LocationOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  getTree(): Promise<RegionArbolDto[]> {
    return this.call('getTree');
  }

  listProvinces(region?: string): Promise<ProvinciaDto[]> {
    return this.call('listProvinces', region ? { region } : {});
  }

  getProvince(id: number): Promise<ProvinciaDto> {
    return this.call('getProvince', { id });
  }

  listCities(filters: { q?: string; provincia_id?: number } = {}): Promise<CiudadDto[]> {
    return this.call('listCities', filters);
  }

  getCity(id: number): Promise<CiudadDto> {
    return this.call('getCity', { id });
  }

  getCities(ids: number[]): Promise<CiudadDto[]> {
    return this.call('getCities', { ids });
  }

  resolveCities(nombres: string[]): Promise<ResolucionDto> {
    return this.call('resolveCities', { nombres });
  }
}
