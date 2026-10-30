import type { DataSource, EntityManager } from 'typeorm';
import type { Agreement } from '../application/agreement';

const SELECT = `SELECT a.apr_id, a.apr_proveedor_codigo, a.apr_nombre_comercial, a.apr_permite_promociones,
    a.apr_porcentaje_descuento_max::float8 AS porcentaje, a.apr_fecha_acuerdo::text AS fecha, a.apr_vigencia_hasta::text AS vigencia,
    a.apr_condiciones_combo, a.apr_contacto_nombre, a.apr_contacto_correo, a.apr_contacto_telefono,
    coalesce((SELECT array_agg(d.ciu_id ORDER BY d.ciu_id) FROM acuerdo_promocion_destino d WHERE d.apr_id = a.apr_id), '{}') AS destinos
  FROM acuerdo_promocion a WHERE a.apr_proveedor_codigo = $1`;

interface Row {
  apr_id: number;
  apr_proveedor_codigo: string;
  apr_nombre_comercial: string | null;
  apr_permite_promociones: boolean;
  porcentaje: number;
  fecha: string;
  vigencia: string;
  apr_condiciones_combo: string | null;
  apr_contacto_nombre: string | null;
  apr_contacto_correo: string | null;
  apr_contacto_telefono: string | null;
  destinos: number[];
}

const toAgreement = (r: Row): Agreement => ({
  providerCode: r.apr_proveedor_codigo,
  commercialName: r.apr_nombre_comercial,
  allowsPromotions: r.apr_permite_promociones,
  maxDiscount: r.porcentaje,
  agreementDate: r.fecha,
  validUntil: r.vigencia,
  comboConditions: r.apr_condiciones_combo,
  contact: { name: r.apr_contacto_nombre, email: r.apr_contacto_correo, phone: r.apr_contacto_telefono },
  destinationIds: r.destinos.map(Number),
});

/** Acuerdo B2B de promociones (un acuerdo por proveedor; la tienda tiene uno). */
export class AgreementRepository {
  constructor(private readonly db: DataSource) {}

  async get(providerCode: string): Promise<Agreement | null> {
    const [row]: Row[] = await this.db.query(SELECT, [providerCode]);
    return row ? toAgreement(row) : null;
  }

  /**
   * Reemplaza el acuerdo con lo que calcule `next` a partir del actual (bloqueado durante la transacción, para que dos
   * `PUT` simultáneos no se pisen). Lo crea si el proveedor todavía no tiene acuerdo.
   */
  async save(providerCode: string, next: (current: Agreement | null) => Promise<Agreement>): Promise<Agreement> {
    return this.db.transaction(async (m) => {
      const [row]: Row[] = await m.query(`${SELECT} FOR UPDATE OF a`, [providerCode]);
      const agreement = await next(row ? toAgreement(row) : null);
      const values = [
        providerCode, agreement.commercialName, agreement.allowsPromotions, agreement.maxDiscount, agreement.agreementDate, agreement.validUntil,
        agreement.comboConditions, agreement.contact.name, agreement.contact.email, agreement.contact.phone,
      ];
      const id = row
        ? (await this.update(m, row.apr_id, values), row.apr_id)
        : (await m.query(
          `INSERT INTO acuerdo_promocion (apr_proveedor_codigo, apr_nombre_comercial, apr_permite_promociones, apr_porcentaje_descuento_max,
             apr_fecha_acuerdo, apr_vigencia_hasta, apr_condiciones_combo, apr_contacto_nombre, apr_contacto_correo, apr_contacto_telefono)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING apr_id`,
          values,
        ))[0].apr_id;
      await m.query(`DELETE FROM acuerdo_promocion_destino WHERE apr_id = $1`, [id]);
      if (agreement.destinationIds.length) {
        await m.query(`INSERT INTO acuerdo_promocion_destino (apr_id, ciu_id) SELECT $1, unnest($2::smallint[])`, [id, agreement.destinationIds]);
      }
      const [saved]: Row[] = await m.query(SELECT, [providerCode]);
      return toAgreement(saved);
    });
  }

  private async update(m: EntityManager, id: number, values: unknown[]): Promise<void> {
    await m.query(
      `UPDATE acuerdo_promocion SET apr_nombre_comercial = $2, apr_permite_promociones = $3, apr_porcentaje_descuento_max = $4,
          apr_fecha_acuerdo = $5, apr_vigencia_hasta = $6, apr_condiciones_combo = $7, apr_contacto_nombre = $8,
          apr_contacto_correo = $9, apr_contacto_telefono = $10
        WHERE apr_id = $11 AND apr_proveedor_codigo = $1`,
      [...values, id],
    );
  }
}
