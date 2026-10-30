import type { EsbClient } from '@atracciones/platform';
import type { BillingProfileDto, BillingProfileHealthDto, BillingProfileRequestDto, LegacyBillingDto, LegacyBillingRequestDto } from '../contract';
import type { BillingProfileOperation } from './esb-routes';

/**
 * Cliente de Billing Profile a través del ESB (operaciones de `MS_BILLING_PROFILE_ROUTES`). Usa el principal de la
 * petición en curso: el ESB lo reenvía. Los errores llegan como `AppError` con el estado y el código del servicio
 * (p. ej. 409 `BILLING_PROFILE_EXISTS`).
 *
 * - GraphQL: `/usuarios/me/**` con el JWT del usuario (`getLegacy` / `saveLegacy` reemplazan a `identity.getBilling` /
 *   `identity.saveBilling`).
 * - Order e Invoicing: `getProfile` con su cuenta de servicio, para copiar el comprador a la factura.
 */
export class BillingProfileClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'billing',
  ) {}

  private call<T>(operation: BillingProfileOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  health(): Promise<BillingProfileHealthDto> {
    return this.call('health');
  }

  // Mis datos de facturación -----------------------------------------------------

  listMine(): Promise<BillingProfileDto[]> {
    return this.call('listMine');
  }

  create(profile: BillingProfileRequestDto): Promise<BillingProfileDto> {
    return this.call('create', profile);
  }

  replace(id: number, profile: BillingProfileRequestDto): Promise<BillingProfileDto> {
    return this.call('replace', { ...profile, id });
  }

  async deactivate(id: number): Promise<void> {
    await this.call('deactivate', { id });
  }

  setPrincipal(id: number): Promise<BillingProfileDto> {
    return this.call('setPrincipal', { id });
  }

  // Compatibilidad con Identity --------------------------------------------------

  getLegacy(): Promise<{ facturacion: LegacyBillingDto | null }> {
    return this.call('getLegacy');
  }

  saveLegacy(billing: LegacyBillingRequestDto): Promise<LegacyBillingDto> {
    return this.call('saveLegacy', billing);
  }

  // Uso interno --------------------------------------------------------------------

  /** También perfiles inactivos (la orden pudo crearse antes de que el usuario lo desactivara). */
  getProfile(id: number): Promise<BillingProfileDto> {
    return this.call('getProfile', { id });
  }
}
