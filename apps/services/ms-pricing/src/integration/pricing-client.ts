import type { EsbClient } from '@atracciones/platform';
import type {
  CloseTariffRequest,
  PriceTable,
  PriceTableList,
  PricingHealth,
  Quote,
  QuoteTicketsRequest,
  SetPriceTableRequest,
  SetTariffRequest,
  Tariff,
  TariffList,
} from '../contract';
import type { PricingOperation } from './esb-routes';

/**
 * Cliente de Pricing a través del ESB (operaciones de `MS_PRICING_ROUTES`). Los errores llegan como `AppError`: 400
 * (datos inválidos), 422 `PRICE_NOT_AVAILABLE` / `TARIFF_OVERLAP`, 404 `TARIFF_NOT_FOUND`.
 *
 * - Order: `quoteTickets` al crear la orden; guarda `unit_price` y `tariff_id` de cada línea.
 * - Catalog / Partner API: `getPriceTables` (búsqueda, precio "desde") y `getPriceTable` (ficha).
 * - Inventory: `getPriceTable` para `price_adult` y `price_child` de cada turno.
 * - GraphQL (administrador): `listTariffs`, `setPriceTable`, `setTariff`, `closeTariff`.
 */
export class PricingClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'pricing',
  ) {}

  private call<T>(operation: PricingOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  health(): Promise<PricingHealth> {
    return this.call('health');
  }

  /** Tabla vigente de una atracción; `date` vacía = hoy. */
  getPriceTable(attractionId: string, date = ''): Promise<PriceTable> {
    return this.call('getPriceTable', { attraction_id: attractionId, date });
  }

  /** Tablas vigentes de hasta 100 atracciones (solo las que tienen alguna tarifa). */
  async getPriceTables(attractionIds: string[], date = ''): Promise<PriceTable[]> {
    if (!attractionIds.length) return [];
    return (await this.call<PriceTableList>('getPriceTables', { attraction_ids: attractionIds, date })).items ?? [];
  }

  quoteTickets(request: Partial<QuoteTicketsRequest> & Pick<QuoteTicketsRequest, 'attraction_id' | 'date' | 'adult_count'>): Promise<Quote> {
    return this.call('quoteTickets', request);
  }

  async listTariffs(attractionId: string, includeHistory = false): Promise<TariffList['items']> {
    return (await this.call<TariffList>('listTariffs', { attraction_id: attractionId, include_history: includeHistory })).items ?? [];
  }

  setPriceTable(request: SetPriceTableRequest): Promise<PriceTable> {
    return this.call('setPriceTable', request);
  }

  setTariff(request: Partial<SetTariffRequest> & Pick<SetTariffRequest, 'attraction_id' | 'ticket_type' | 'price'>): Promise<Tariff> {
    return this.call('setTariff', request);
  }

  closeTariff(request: CloseTariffRequest): Promise<Tariff> {
    return this.call('closeTariff', request);
  }
}
