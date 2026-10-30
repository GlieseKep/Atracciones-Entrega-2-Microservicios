import type { EsbClient } from '@atracciones/platform';
import type { GetPriceTableRequest, ListTariffsRequest, PriceTable, Quote, QuoteTicketsRequest, SetPriceTableRequest, TariffList } from '../contract';
import type { PricingOperation } from './esb-routes';

/**
 * Cliente de Pricing a través del ESB (operaciones de `MS_PRICING_ROUTES`).
 *
 * - Order: `quoteTickets`, con la fecha de la actividad.
 * - GraphQL: precio del carrito y tarifas en el panel.
 */
export class PricingClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'pricing',
  ) {}

  private call<T>(operation: PricingOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  quoteTickets(request: QuoteTicketsRequest): Promise<Quote> {
    return this.call('quoteTickets', request);
  }

  getPriceTable(request: GetPriceTableRequest): Promise<PriceTable> {
    return this.call('getPriceTable', request);
  }

  listTariffs(request: ListTariffsRequest): Promise<TariffList> {
    return this.call('listTariffs', request);
  }

  setPriceTable(request: SetPriceTableRequest): Promise<PriceTable> {
    return this.call('setPriceTable', request);
  }
}
