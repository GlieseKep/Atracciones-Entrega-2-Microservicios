import { AppError } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { ClienteApiCreadoDto, ClienteApiDto } from '../contract';
import type { ApiClientRepository } from '../persistence/api-client-repository';
import { recordApiClientEvent } from './audit-events';
import { randomToken, sha256 } from './tokens';

/** Socios con `X-API-Key`. Altas y cambios de estado van a la bitácora (`CLIENTE_API_*`), sin la clave. */
export class ApiClientService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clients: ApiClientRepository,
  ) {}

  /** La clave solo existe en esta respuesta: se guarda su SHA-256. */
  async create(codigo: string, nombre: string, adminId: number): Promise<ClienteApiCreadoDto> {
    const apiKey = randomToken();
    const client = await this.dataSource.transaction(async (m) => {
      const created = await this.clients.create(codigo, nombre, sha256(apiKey), m);
      await recordApiClientEvent(m, 'CLIENTE_API_CREADO', adminId, created);
      return created;
    });
    return { ...client, api_key: apiKey };
  }

  async rename(id: number, nombre: string): Promise<ClienteApiDto> {
    const client = await this.clients.rename(id, nombre);
    if (!client) throw AppError.notFound(`No existe el cliente API ${id}.`, 'API_CLIENT_NOT_FOUND');
    return client;
  }

  /** La clave anterior deja de valer. Igual que al crear, la nueva solo existe en esta respuesta. */
  async regenerateKey(id: number): Promise<ClienteApiCreadoDto> {
    const apiKey = randomToken();
    const client = await this.clients.setKey(id, sha256(apiKey));
    if (!client) throw AppError.notFound(`No existe el cliente API ${id}.`, 'API_CLIENT_NOT_FOUND');
    return { ...client, api_key: apiKey };
  }

  list(): Promise<ClienteApiDto[]> {
    return this.clients.list();
  }

  async setActive(id: number, activo: boolean, adminId: number): Promise<ClienteApiDto> {
    return this.dataSource.transaction(async (m) => {
      const before = await this.clients.activeState(id, m);
      const client = before === null ? null : await this.clients.setActive(id, activo, m);
      if (!client) throw AppError.notFound(`No existe el cliente API ${id}.`, 'API_CLIENT_NOT_FOUND');
      // Sin cambio de estado no hay evento.
      if (before !== activo) await recordApiClientEvent(m, activo ? 'CLIENTE_API_ACTIVADO' : 'CLIENTE_API_DESACTIVADO', adminId, client);
      return client;
    });
  }
}
