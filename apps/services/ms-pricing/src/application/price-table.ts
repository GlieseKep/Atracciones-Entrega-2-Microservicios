import type { PriceTable, TicketType } from '../contract';

/** Tarifa vigente de un tipo de boleto (una fila de `tarifa`). */
export interface TariffRow {
  tar_id: number;
  atr_codigo: string;
  tar_tipo: TicketType;
  tar_precio: number;
  tar_moneda: string;
  valid_from: string;
  valid_to: string | null;
}

const FIELD: Record<TicketType, keyof Pick<PriceTable, 'adult' | 'child' | 'senior' | 'infant' | 'student'>> = {
  ADULT: 'adult',
  CHILD: 'child',
  SENIOR: 'senior',
  INFANT: 'infant',
  STUDENT: 'student',
};

/** Precio "desde" para listados: la tarifa ADULT o, sin ella, la menor tarifa mayor que 0. */
export function fromPrice(table: Omit<PriceTable, 'from_price'>): number | undefined {
  if (table.adult !== undefined) return table.adult;
  const positive = [table.child, table.senior, table.student, table.infant].filter((p): p is number => p !== undefined && p > 0);
  return positive.length ? Math.min(...positive) : undefined;
}

/**
 * `PriceTable` de una atracción con sus tarifas vigentes en `date`. Un tipo sin tarifa no aparece (no se envía 0, para
 * no confundirlo con INFANT gratis). La moneda es la de ADULT o, sin ella, la de cualquier tarifa.
 */
export function buildPriceTable(attractionId: string, date: string, rows: TariffRow[]): PriceTable {
  const table: PriceTable = {
    attraction_id: attractionId,
    date,
    currency: rows.find((r) => r.tar_tipo === 'ADULT')?.tar_moneda ?? rows[0]?.tar_moneda ?? 'USD',
  };
  for (const r of rows) table[FIELD[r.tar_tipo]] = r.tar_precio;
  const from = fromPrice(table);
  if (from !== undefined) table.from_price = from;
  return table;
}
