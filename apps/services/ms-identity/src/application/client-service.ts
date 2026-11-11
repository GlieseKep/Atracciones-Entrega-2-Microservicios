import { AppError, errorFields, type EsbClient, type Logger } from '@atracciones/platform';
import type { ClienteDto, ClienteFiltros, ClienteRequest } from '../contract';
import type { ApiClientRepository } from '../persistence/api-client-repository';
import type { Db } from '../persistence/user-repository';

export interface ClienteResultado {
  cliente: ClienteDto;
  /** `true` si se registró en esta llamada; `false` si ya existía. */
  creado: boolean;
}

/**
 * Turistas que registra un socio (Booking) en `cliente_api`: no tienen clave ni cuenta web. Uno se identifica por su
 * correo o su identificación, así que nunca se duplica. Sus datos de facturación viven en Billing (`cla_id`).
 */
export class ClientService {
  constructor(
    private readonly clients: ApiClientRepository,
    private readonly esb: EsbClient,
    private readonly logger: Logger,
  ) {}

  /** 404 si no existe; 409 si el correo es de un turista y la identificación de otro. */
  async find(filtros: ClienteFiltros): Promise<ClienteDto> {
    const found = await this.lookup(filtros);
    if (!found) throw AppError.notFound('No existe un cliente con esos datos.', 'CLIENT_NOT_FOUND');
    return found;
  }

  /** Devuelve el turista existente o lo registra. En los dos casos asegura sus datos de facturación principales. */
  async ensure(cliente: ClienteRequest): Promise<ClienteResultado> {
    const result = await this.ensureTourist(cliente);
    await this.ensureBilling(result.cliente, cliente);
    return result;
  }

  /**
   * Solo la fila del turista en `cliente_api`, sin Billing: el registro de usuario la llama dentro de su transacción
   * (`db`), así una cuenta nueva nunca queda sin cliente. 409 si el correo es de un turista y la identificación de otro.
   */
  async ensureTourist(cliente: ClienteRequest, db?: Db): Promise<ClienteResultado> {
    const filtros = { email: cliente.email, identificacion: cliente.identificacion };
    const existing = await this.lookup(filtros, db);
    if (existing) return { cliente: existing, creado: false };
    const created = await this.clients.createTourist(cliente, db);
    if (created) return { cliente: created, creado: true };
    // Otro proceso lo registró a la vez: se devuelve ese.
    const other = await this.lookup(filtros, db);
    if (!other) throw AppError.notFound('No existe un cliente con esos datos.', 'CLIENT_NOT_FOUND');
    return { cliente: other, creado: false };
  }

  /**
   * Facturación del cliente creado al registrarse un usuario. Va después de confirmar la cuenta: si Billing falla, la
   * cuenta y el cliente ya existen y solo se registra el error (el siguiente `POST /clientes` la completa).
   */
  async ensureBillingAfterSignup(cliente: ClienteDto, datos: ClienteRequest): Promise<void> {
    try {
      await this.ensureBilling(cliente, datos);
    } catch {
      // `ensureBilling` ya dejó el error en el log.
    }
  }

  private async lookup(filtros: ClienteFiltros, db?: Db): Promise<ClienteDto | null> {
    const rows = await this.clients.findTourists(filtros, db);
    if (rows.length > 1) {
      throw AppError.conflict('CLIENT_DATA_CONFLICT', 'El correo y la identificación pertenecen a clientes distintos.');
    }
    return rows[0] ?? null;
  }

  /** Si Billing falla, el turista ya quedó registrado: el siguiente `POST /clientes` completa la facturación. */
  private async ensureBilling(cliente: ClienteDto, datos: ClienteRequest): Promise<void> {
    try {
      await this.esb.call('billing', 'ensurePrincipalForClient', {
        claId: cliente.client_id,
        tipo_identificacion: /^\d{10}$/.test(cliente.identificacion) ? 'CEDULA' : 'PASAPORTE',
        identificacion: cliente.identificacion,
        razon_social: cliente.nombre,
        correo: cliente.email,
        telefono: datos.telefono ?? cliente.telefono,
      });
    } catch (error) {
      this.logger.error('no se pudieron registrar los datos de facturación del cliente', { client_id: cliente.client_id, ...errorFields(error) });
      throw AppError.unavailable('No se pudieron registrar los datos de facturación del cliente. Reintente.');
    }
  }
}
