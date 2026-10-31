import { money } from '@atracciones/platform';
import type { FacturaLinea } from '../contract';

export interface OrderLineInput {
  det_id: number;
  ticket_type: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Breakdown {
  lines: FacturaLinea[];
  subtotal: number;
  descuento: number;
  iva: number;
  total: number;
}

/** Reparte el descuento en proporción al valor de cada línea. La diferencia de centavos va a la última con valor. */
export function shareDiscount(lines: OrderLineInput[], descuento: number): number[] {
  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  if (total === 0 || descuento === 0) return lines.map(() => 0);
  const shares = lines.map((line) => money((descuento * line.subtotal) / total));
  const last = lines.reduce((found, line, index) => (line.subtotal > 0 ? index : found), 0);
  shares[last] = money(shares[last] + descuento - shares.reduce((sum, share) => sum + share, 0));
  return shares;
}

/**
 * Los precios de la orden ya incluyen IVA. La base se obtiene dividiendo, y `fde_iva` sale por diferencia con lo cobrado:
 * así `fac_total` es exactamente `ord_total`, sin diferencias de centavos.
 */
export function breakdown(lines: OrderLineInput[], descuento: number, ivaPorcentaje: number): Breakdown {
  const factor = 1 + ivaPorcentaje / 100;
  const shares = shareDiscount(lines, descuento);
  const result = lines.map((line, index) => {
    const cobrado = money(line.subtotal - shares[index]);
    const precio = money(line.precio_unitario / factor);
    const bruto = money(line.cantidad * precio);
    // El redondeo no puede dejar una base mayor que lo cobrado, porque el IVA quedaría negativo, ni una base negativa.
    const descuentoNeto = cobrado === 0 ? bruto : money(Math.min(bruto, Math.max(shares[index] / factor, bruto - cobrado)));
    const base = money(bruto - descuentoNeto);
    return {
      det_id: line.det_id,
      codigo: line.ticket_type,
      descripcion: line.descripcion.slice(0, 300),
      cantidad: line.cantidad,
      precio_unitario: precio,
      descuento: descuentoNeto,
      subtotal: base,
      iva_porcentaje: ivaPorcentaje,
      iva: money(cobrado - base),
      total: cobrado,
    };
  });
  const sum = (pick: (line: FacturaLinea) => number) => money(result.reduce((acc, line) => acc + pick(line), 0));
  return {
    lines: result,
    subtotal: sum((line) => line.cantidad * line.precio_unitario),
    descuento: sum((line) => line.descuento),
    iva: sum((line) => line.iva),
    total: sum((line) => line.total),
  };
}
