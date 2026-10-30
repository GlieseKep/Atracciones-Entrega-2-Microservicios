import { AppError, documentReason, isValidDocument, isValidEmail, isValidPhone, TIPOS_DOCUMENTO, type InvalidParam } from '@atracciones/platform';
import type { BillingRow, IdentityRepository, ProfileRow } from '../persistence/repositories';

export const ESTADOS_USUARIO = ['ACTIVO', 'BLOQUEADO', 'DESHABILITADO'] as const;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const nullable = (value: unknown) => text(value) || null;

/** Perfil público de un usuario (sin la contraseña). */
export const toProfile = (row: ProfileRow) => ({
  id: row.id,
  email: row.email,
  nombre_completo: row.nombre_completo,
  tipo: row.tipo,
  estado: row.estado,
  roles: row.roles,
  creado_en: new Date(row.creado_en).toISOString(),
  actualizado_en: new Date(row.actualizado_en).toISOString(),
});

const toBilling = (row: BillingRow) => ({ ...row, actualizado_en: new Date(row.actualizado_en).toISOString() });

/** Perfil, datos de facturación y administración de usuarios y roles (plan §3.1). */
export class UserService {
  constructor(private readonly repo: IdentityRepository) {}

  async profile(id: string) {
    const row = await this.repo.findUserById(id);
    if (!row) throw AppError.notFound('El usuario no existe.', 'USER_NOT_FOUND');
    return toProfile(row);
  }

  async updateProfile(id: string, input: { nombre_completo?: unknown }) {
    const nombre = text(input.nombre_completo);
    if (nombre.length < 2 || nombre.length > 200) {
      throw AppError.validation('El nombre no es válido.', [{ name: 'nombre_completo', reason: 'Debe tener entre 2 y 200 caracteres.' }]);
    }
    await this.repo.updateName(id, nombre);
    return this.profile(id);
  }

  async billing(id: string) {
    const row = await this.repo.billing(id);
    return row ? toBilling(row) : null;
  }

  /** Datos de facturación (comprador de la factura electrónica): documento válido según su tipo, correo y teléfono. */
  async saveBilling(id: string, input: Record<string, unknown>) {
    const data = {
      tipo_documento: text(input.tipo_documento).toUpperCase(),
      numero_documento: text(input.numero_documento).toUpperCase(),
      razon_social: text(input.razon_social),
      email: text(input.email).toLowerCase(),
      telefono: nullable(input.telefono),
      direccion: nullable(input.direccion),
    };
    const invalid: InvalidParam[] = [];
    if (!TIPOS_DOCUMENTO.includes(data.tipo_documento as (typeof TIPOS_DOCUMENTO)[number])) {
      invalid.push({ name: 'tipo_documento', reason: `Debe ser uno de ${TIPOS_DOCUMENTO.join(', ')}.` });
    } else if (!isValidDocument(data.tipo_documento, data.numero_documento)) {
      invalid.push({ name: 'numero_documento', reason: documentReason(data.tipo_documento) });
    }
    if (data.razon_social.length < 2 || data.razon_social.length > 200) invalid.push({ name: 'razon_social', reason: 'Debe tener entre 2 y 200 caracteres.' });
    if (!isValidEmail(data.email)) invalid.push({ name: 'email', reason: 'Debe ser un correo electrónico válido.' });
    if (data.telefono && !isValidPhone(data.telefono)) invalid.push({ name: 'telefono', reason: 'Formato E.164 o celular de Ecuador (09XXXXXXXX).' });
    if (data.direccion && data.direccion.length > 300) invalid.push({ name: 'direccion', reason: 'Máximo 300 caracteres.' });
    if (invalid.length) throw AppError.validation('Los datos de facturación no son válidos.', invalid);
    await this.repo.saveBilling(id, data);
    return (await this.billing(id))!;
  }

  async list(filters: { search: string | null; estado: string | null; rol: string | null; limit: number; offset: number }) {
    const page = await this.repo.listUsers(filters);
    return { total: page.total, items: page.items.map(toProfile) };
  }

  async batch(ids: unknown) {
    const valid = Array.isArray(ids) ? ids.map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];
    return (await this.repo.findUsersByIds([...new Set(valid)])).map(toProfile);
  }

  async setStatus(id: string, estado: unknown, actorId: string) {
    if (!ESTADOS_USUARIO.includes(estado as (typeof ESTADOS_USUARIO)[number])) {
      throw AppError.validation('Estado inválido.', [{ name: 'estado', reason: `Debe ser uno de ${ESTADOS_USUARIO.join(', ')}.` }]);
    }
    if (id === actorId && estado !== 'ACTIVO') throw AppError.conflict('CANNOT_DISABLE_SELF', 'Un administrador no puede bloquear su propia cuenta.');
    if (!(await this.repo.setStatus(id, String(estado)))) throw AppError.notFound('El usuario no existe.', 'USER_NOT_FOUND');
    return this.profile(id);
  }

  async grantRole(id: string, input: { rol?: unknown; motivo?: unknown }, actorId: string) {
    const rol = text(input.rol);
    const motivo = text(input.motivo) || 'Asignado desde la administración';
    await this.profile(id);
    if (!(await this.repo.grantRole(id, rol, motivo.slice(0, 500), actorId))) throw AppError.notFound(`No existe el rol '${rol}'.`, 'ROLE_NOT_FOUND');
    return this.profile(id);
  }

  async revokeRole(id: string, rol: string, actorId: string) {
    if (id === actorId && rol === 'admin') throw AppError.conflict('CANNOT_REVOKE_OWN_ADMIN', 'Un administrador no puede quitarse su propio rol de administrador.');
    await this.profile(id);
    await this.repo.revokeRole(id, rol);
    return this.profile(id);
  }

  roles() {
    return this.repo.roles();
  }

  async stats() {
    const rows = await this.repo.countByStatus();
    return { por_estado: Object.fromEntries(rows.map((r) => [r.estado, r.total])), total: rows.reduce((s, r) => s + r.total, 0) };
  }
}
