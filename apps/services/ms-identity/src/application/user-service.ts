import { AppError } from '@atracciones/platform';
import type { DataSource } from 'typeorm';
import type { PerfilUpdateRequest, RolNombre, UsuarioDto, UsuarioPageDto } from '../contract';
import type { SessionRepository } from '../persistence/session-repository';
import type { UserRepository, UsuarioFiltros } from '../persistence/user-repository';
import { hashPassword } from './passwords';

const userNotFound = (id: number) => AppError.notFound(`No existe el usuario ${id}.`, 'USER_NOT_FOUND');

export class UserService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
  ) {}

  async get(id: number): Promise<UsuarioDto> {
    const user = await this.users.findById(id);
    if (!user) throw userNotFound(id);
    return user;
  }

  async updateProfile(id: number, patch: PerfilUpdateRequest): Promise<UsuarioDto> {
    const user = await this.users.updateProfile(id, patch);
    if (!user) throw userNotFound(id);
    return user;
  }

  async list(filters: UsuarioFiltros): Promise<UsuarioPageDto> {
    const { total, items } = await this.users.list(filters);
    return {
      metadata: { total_results: total, page: filters.page, limit: filters.limit, total_pages: Math.ceil(total / filters.limit) },
      data: items,
    };
  }

  /** Desactivar revoca sus sesiones. Un administrador no puede desactivarse a sí mismo. */
  async setActive(id: number, activo: boolean, adminId: number): Promise<UsuarioDto> {
    if (!activo && id === adminId) throw AppError.conflict('CANNOT_DISABLE_SELF', 'Un administrador no puede desactivarse a sí mismo.');
    await this.dataSource.transaction(async (m) => {
      if (!(await this.users.setActive(id, activo, m))) throw userNotFound(id);
      if (!activo) await this.sessions.revokeAll(id, m);
    });
    return this.get(id);
  }

  async assignRole(id: number, rol: RolNombre, adminId: number): Promise<UsuarioDto> {
    await this.get(id);
    if (!(await this.users.assignRole(id, rol, adminId))) throw AppError.conflict('ROLE_ALREADY_ASSIGNED', `El usuario ya tiene el rol ${rol}.`);
    return this.get(id);
  }

  /** Un administrador no puede quitarse su propio rol `ADMIN`: perdería el acceso al panel. */
  async removeRole(id: number, rol: RolNombre, adminId: number): Promise<UsuarioDto> {
    if (rol === 'ADMIN' && id === adminId) throw AppError.conflict('CANNOT_REMOVE_OWN_ADMIN', 'Un administrador no puede quitarse su propio rol ADMIN.');
    await this.get(id);
    if (!(await this.users.removeRole(id, rol))) throw AppError.notFound(`El usuario no tiene el rol ${rol}.`, 'ROLE_NOT_ASSIGNED');
    return this.get(id);
  }

  /** Primer administrador (`tools/create-admin.mjs`): solo funciona mientras no exista ninguno. */
  async createFirstAdmin(input: { correo: string; password: string; nombre: string; apellido: string }): Promise<UsuarioDto> {
    if (await this.users.adminExists()) throw AppError.conflict('ADMIN_ALREADY_EXISTS', 'Ya existe un administrador.');
    const passwordHash = await hashPassword(input.password);
    const id = await this.dataSource.transaction(async (m) => {
      const usuId = await this.users.create(m, { ...input, documento: null, telefono: null, fecha_nacimiento: null }, passwordHash);
      await this.users.assignRole(usuId, 'ADMIN', null, m);
      await this.users.markVerified(usuId, m);
      return usuId;
    });
    return this.get(id);
  }
}
