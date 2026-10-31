import type { EsbClient } from '@atracciones/platform';
import type { BitacoraPage } from '../contract';
import type { AuditOperation } from './esb-routes';

/** Cliente de Audit a través del ESB (operaciones de `MS_AUDIT_ROUTES`), para el panel en GraphQL. */
export class AuditClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'audit',
  ) {}

  private call<T>(operation: AuditOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  listEntries(
    filters: { accion?: string; entidad?: string; entidad_id?: string; correlation_id?: string; usu_id?: number; desde?: string; hasta?: string; page?: number; limit?: number } = {},
  ): Promise<BitacoraPage> {
    return this.call('listEntries', filters);
  }

  listActions(): Promise<string[]> {
    return this.call('listActions');
  }
}
