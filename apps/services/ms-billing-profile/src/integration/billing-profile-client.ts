import type { EsbClient } from '@atracciones/platform';
import type { DatoFacturacionDto, DatoFacturacionInput } from '../contract';
import type { BillingOperation } from './esb-routes';

/**
 * Cliente de Billing Profile a través del ESB (operaciones de `MS_BILLING_ROUTES`).
 *
 * - Invoicing: `getPrincipal`. Un `404` significa que se factura a consumidor final.
 * - GraphQL: perfiles del portal.
 */
export class BillingProfileClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'billing',
  ) {}

  private call<T>(operation: BillingOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  getPrincipal(usuId: number): Promise<DatoFacturacionDto> {
    return this.call('getPrincipal', { usuId });
  }

  list(): Promise<DatoFacturacionDto[]> {
    return this.call('listProfiles');
  }

  create(input: Partial<DatoFacturacionInput>): Promise<DatoFacturacionDto> {
    return this.call('createProfile', input);
  }

  replace(id: number, input: Partial<DatoFacturacionInput>): Promise<DatoFacturacionDto> {
    return this.call('replaceProfile', { id, ...input });
  }

  remove(id: number): Promise<void> {
    return this.call('deleteProfile', { id });
  }

  markPrincipal(id: number): Promise<DatoFacturacionDto> {
    return this.call('markPrincipal', { id });
  }
}
