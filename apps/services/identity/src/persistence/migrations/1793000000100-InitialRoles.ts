import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles iniciales y sus scopes. `partner` es el rol del usuario dueño de la clave de API de Booking Prototipo
 * (la clave recibe sus propios scopes en `api_cliente_scope`).
 */
const ROLES: Record<string, { descripcion: string; scopes: string[] }> = {
  admin: {
    descripcion: 'Administrador de la tienda',
    scopes: ['attractions:read', 'attractions:book', 'attractions:cancel', 'attractions:checkin', 'attractions:write', 'promotions:read', 'promotions:write', 'events:read'],
  },
  cliente: { descripcion: 'Cliente del portal web', scopes: ['attractions:read', 'attractions:book', 'attractions:cancel'] },
  guia: { descripcion: 'Guía que valida el check-in en el punto de encuentro', scopes: ['attractions:read', 'attractions:checkin'] },
  partner: {
    descripcion: 'Agregador externo (Booking Prototipo)',
    scopes: ['attractions:read', 'attractions:book', 'attractions:cancel', 'attractions:checkin', 'promotions:read', 'events:read'],
  },
};

export class InitialRoles1793000000100 implements MigrationInterface {
  name = 'InitialRoles1793000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [nombre, rol] of Object.entries(ROLES)) {
      await queryRunner.query(`INSERT INTO rol (nombre, descripcion) VALUES ($1, $2) ON CONFLICT (nombre) DO NOTHING`, [nombre, rol.descripcion]);
      await queryRunner.query(
        `INSERT INTO rol_scope (rol_id, scope) SELECT r.id, s.scope FROM rol r CROSS JOIN unnest($2::varchar[]) AS s(scope)
          WHERE r.nombre = $1 ON CONFLICT DO NOTHING`,
        [nombre, rol.scopes],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM rol WHERE nombre = ANY($1::varchar[])`, [Object.keys(ROLES)]);
  }
}
