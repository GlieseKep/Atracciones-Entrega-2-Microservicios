import type { EsbClient } from '@atracciones/platform';
import type { MensajeDto, MensajeInput, MensajePage } from '../contract';
import type { SupportOperation } from './esb-routes';

/** Cliente de Support a través del ESB (operaciones de `MS_SUPPORT_ROUTES`), para GraphQL. */
export class SupportClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'support',
  ) {}

  private call<T>(operation: SupportOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  sendMessage(input: MensajeInput): Promise<{ id: number; creado_en: string }> {
    return this.call('sendMessage', input);
  }

  listMessages(filters: { leido?: boolean; page?: number; limit?: number } = {}): Promise<MensajePage> {
    return this.call('listMessages', filters);
  }

  setMessageRead(id: number, leido: boolean): Promise<MensajeDto> {
    return this.call('setMessageRead', { id, leido });
  }
}
