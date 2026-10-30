import type { EsbClient } from '@atracciones/platform';
import type { ContactMessageDto, ContactMessagePageDto, ContactMessageRequestDto, ContactSummaryDto, MessageStatus, SupportHealthDto } from '../contract';
import type { SupportOperation } from './esb-routes';

/**
 * Cliente de Support a través del ESB (operaciones de `MS_SUPPORT_ROUTES`). Usa el principal de la petición en curso:
 * el ESB lo reenvía. Mismas entradas y salidas que `audit.sendContactMessage`, `audit.listContactMessages` y
 * `audit.setContactMessageStatus`, para que GraphQL solo cambie de servicio.
 */
export class SupportClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'support',
  ) {}

  private call<T>(operation: SupportOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  health(): Promise<SupportHealthDto> {
    return this.call('health');
  }

  /** Público; 429 `TOO_MANY_REQUESTS` si el correo superó el límite por hora. */
  sendContactMessage(message: ContactMessageRequestDto): Promise<ContactMessageDto> {
    return this.call('sendContactMessage', message);
  }

  listContactMessages(filters: { estado?: MessageStatus; search?: string; limit?: number; offset?: number } = {}): Promise<ContactMessagePageDto> {
    return this.call('listContactMessages', filters);
  }

  contactSummary(): Promise<ContactSummaryDto> {
    return this.call('contactSummary');
  }

  setContactMessageStatus(id: string, estado: MessageStatus): Promise<ContactMessageDto> {
    return this.call('setContactMessageStatus', { id, estado });
  }
}
