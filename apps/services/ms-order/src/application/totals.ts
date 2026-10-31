import { money } from '@atracciones/platform';

export interface Totals {
  subtotal: number;
  descuento: number;
  iva: number;
  total: number;
}

/** Las tarifas ya incluyen el IVA: `ord_iva` es 0 y el total es el precio que ve el cliente. Invoicing lo separa en la factura. */
export function orderTotals(subtotal: number, descuento: number): Totals {
  const applied = money(Math.min(descuento, subtotal));
  return { subtotal: money(subtotal), descuento: applied, iva: 0, total: money(subtotal - applied) };
}
