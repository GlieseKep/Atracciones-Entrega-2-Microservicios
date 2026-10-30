import type { PriceTable, Tariff } from '../contract';
import type { TariffRow } from '../persistence/pricing-repository';

/** `null` si no hay una tabla completa en esa fecha. */
export function priceTableOf(codigo: string, date: string, rows: TariffRow[]): PriceTable | null {
  const price = (tipo: TariffRow['tar_tipo']) => {
    const row = rows.find((item) => item.tar_tipo === tipo);
    return row ? Number(row.tar_precio) : null;
  };
  const [adult, child, senior, infant, student] = [price('ADULT'), price('CHILD'), price('SENIOR'), price('INFANT'), price('STUDENT')];
  if (adult === null || child === null || senior === null || infant === null) return null;
  return {
    attraction_id: codigo,
    date,
    currency: rows[0].tar_moneda,
    adult,
    child,
    senior,
    infant,
    ...(student === null ? {} : { student }),
  };
}

/** Datos de `TARIFA_ACTUALIZADA`: Catalog guarda la tabla vigente completa. */
export const tariffUpdatedPayload = (table: PriceTable) => ({ attraction_id: table.attraction_id, current_prices: table });

export const toTariff = (row: TariffRow, today: string): Tariff => ({
  tariff_id: Number(row.tar_id),
  attraction_id: row.atr_codigo,
  ticket_type: row.tar_tipo,
  price: Number(row.tar_precio),
  currency: row.tar_moneda,
  valid_from: row.tar_vigente_desde,
  valid_to: row.tar_vigente_hasta ?? '',
  current: row.tar_vigente_desde <= today && (row.tar_vigente_hasta === null || row.tar_vigente_hasta >= today),
});
