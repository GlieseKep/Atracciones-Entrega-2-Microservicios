import type { DataSource } from 'typeorm';
import type { AgreementInput } from '../contract';

export interface AgreementRow {
  apr_id: number;
  apr_proveedor_codigo: string;
  apr_nombre_comercial: string | null;
  apr_permite_promociones: boolean;
  apr_porcentaje_descuento_max: string;
  apr_fecha_acuerdo: string;
  apr_vigencia_hasta: string;
  apr_condiciones_combo: string | null;
}

export class AgreementRepository {
  constructor(private readonly db: DataSource) {}

  /** Hay un solo acuerdo: lo carga el script inicial. */
  async get(): Promise<{ row: AgreementRow; cityIds: number[] }> {
    const [row] = await this.db.query(
      `SELECT apr_id, apr_proveedor_codigo, apr_nombre_comercial, apr_permite_promociones, apr_porcentaje_descuento_max,
              apr_fecha_acuerdo::text AS apr_fecha_acuerdo, apr_vigencia_hasta::text AS apr_vigencia_hasta, apr_condiciones_combo
       FROM acuerdo_promocion ORDER BY apr_id LIMIT 1`,
    );
    const destinations: { ciu_id: number }[] = await this.db.query(`SELECT ciu_id FROM acuerdo_promocion_destino WHERE apr_id = $1`, [row.apr_id]);
    return { row, cityIds: destinations.map((item) => item.ciu_id) };
  }

  /** Lo que no se envió conserva su valor. `cityIds`, si llega, reemplaza la lista. */
  async update(aprId: number, input: AgreementInput, today: string, cityIds: number[] | undefined): Promise<void> {
    await this.db.transaction(async (m) => {
      const sets = ['apr_permite_promociones = $2', 'apr_porcentaje_descuento_max = $3', 'apr_fecha_acuerdo = $4'];
      const params: unknown[] = [aprId, input.permite, input.porcentaje, today];
      const optional: [string, unknown][] = [
        ['apr_vigencia_hasta', input.vigenciaHasta],
        ['apr_condiciones_combo', input.condiciones],
        ['apr_contacto_nombre', input.contactoNombre],
        ['apr_contacto_correo', input.contactoCorreo],
        ['apr_contacto_telefono', input.contactoTelefono],
      ];
      for (const [column, value] of optional) {
        if (value === undefined) continue;
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }
      await m.query(`UPDATE acuerdo_promocion SET ${sets.join(', ')} WHERE apr_id = $1`, params);
      if (cityIds) {
        await m.query(`DELETE FROM acuerdo_promocion_destino WHERE apr_id = $1`, [aprId]);
        await m.query(`INSERT INTO acuerdo_promocion_destino (apr_id, ciu_id) SELECT $1::smallint, unnest($2::smallint[])`, [aprId, cityIds]);
      }
    });
  }
}
