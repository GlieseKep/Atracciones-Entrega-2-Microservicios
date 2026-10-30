import type { EsbClient } from '@atracciones/platform';
import type { GuiaDto, LogisticaReserva, ReferenciaAtraccion } from '../contract';
import type { CatalogOperation } from './esb-routes';

/**
 * Cliente de Catalog a través del ESB (operaciones de `MS_CATALOG_ROUTES`). Las demás operaciones se llaman con `call`.
 *
 * - Booking: `getLogistics` y `getGuide`.
 * - Review, Cart y Order: `getReference`.
 * - GraphQL: catálogo y administración.
 */
export class CatalogClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'catalog',
  ) {}

  call<T>(operation: CatalogOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  getReference(id: string): Promise<ReferenciaAtraccion> {
    return this.call('getReference', { id });
  }

  getLogistics(id: string, guiId?: number): Promise<LogisticaReserva> {
    return this.call('getLogistics', guiId === undefined ? { id } : { id, gui_id: guiId });
  }

  getGuide(codigo: string): Promise<GuiaDto> {
    return this.call('getGuide', { codigo });
  }
}
