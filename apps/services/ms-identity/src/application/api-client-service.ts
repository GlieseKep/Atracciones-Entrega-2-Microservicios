import { AppError } from '@atracciones/platform';
import type { ClienteApiCreadoDto, ClienteApiDto } from '../contract';
import type { ApiClientRepository } from '../persistence/api-client-repository';
import { randomToken, sha256 } from './tokens';

export class ApiClientService {
  constructor(private readonly clients: ApiClientRepository) {}

  /** La clave solo existe en esta respuesta: se guarda su SHA-256. */
  async create(codigo: string, nombre: string): Promise<ClienteApiCreadoDto> {
    const apiKey = randomToken();
    return { ...(await this.clients.create(codigo, nombre, sha256(apiKey))), api_key: apiKey };
  }

  list(): Promise<ClienteApiDto[]> {
    return this.clients.list();
  }

  async setActive(id: number, activo: boolean): Promise<ClienteApiDto> {
    const client = await this.clients.setActive(id, activo);
    if (!client) throw AppError.notFound(`No existe el cliente API ${id}.`, 'API_CLIENT_NOT_FOUND');
    return client;
  }
}
