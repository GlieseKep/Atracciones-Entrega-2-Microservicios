import type { EsbClient } from '@atracciones/platform';
import type { PrincipalDto, RegistroRequest, SesionResponse, UsuarioDto, UsuarioResumenDto } from '../contract';
import type { IdentityOperation } from './esb-routes';

/**
 * Cliente de Identity a través del ESB (operaciones de `MS_IDENTITY_ROUTES`). Las demás operaciones se llaman con
 * `call`. Los errores llegan como `AppError` con el estado y el código del servicio.
 *
 * - API Gateway: `validateToken` y `validateApiKey`.
 * - Servicios que guardan `usu_id`: `getUsers`.
 * - GraphQL: registro, sesión, perfil y administración.
 */
export class IdentityClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'identity',
  ) {}

  call<T>(operation: IdentityOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  validateToken(token: string): Promise<PrincipalDto> {
    return this.call('validateToken', { token });
  }

  validateApiKey(apiKey: string): Promise<PrincipalDto> {
    return this.call('validateApiKey', { api_key: apiKey });
  }

  getUsers(ids: number[]): Promise<UsuarioResumenDto[]> {
    return this.call('getUsers', { ids });
  }

  register(input: RegistroRequest): Promise<UsuarioDto> {
    return this.call('register', input);
  }

  login(correo: string, password: string): Promise<SesionResponse> {
    return this.call('login', { correo, password });
  }

  refresh(refreshToken: string): Promise<SesionResponse> {
    return this.call('refresh', { refresh_token: refreshToken });
  }

  getMe(): Promise<UsuarioDto> {
    return this.call('getMe');
  }
}
