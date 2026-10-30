/** Clave de acceso de los comprobantes electrónicos del SRI (ficha técnica de comprobantes electrónicos offline). */

/** Dígito verificador módulo 11 (factores 2 a 7 de derecha a izquierda; 11 → 0, 10 → 1). */
export function modulo11(digits: string): number {
  let factor = 2;
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const result = 11 - (sum % 11);
  return result === 11 ? 0 : result === 10 ? 1 : result;
}

export interface ClaveAccesoInput {
  /** Fecha de emisión `YYYY-MM-DD`. */
  fecha: string;
  /** `01` factura, `04` nota de crédito. */
  tipoComprobante: '01' | '04';
  ruc: string;
  /** `1` pruebas, `2` producción. */
  ambiente: '1' | '2';
  establecimiento: string;
  puntoEmision: string;
  secuencial: string;
  /** Código numérico de 8 dígitos elegido por el emisor. */
  codigoNumerico: string;
}

/** 49 dígitos: fecha (ddmmaaaa) + tipo + RUC + ambiente + serie + secuencial + código numérico + emisión normal (1) + dígito verificador. */
export function claveAcceso(c: ClaveAccesoInput): string {
  const [y, m, d] = c.fecha.split('-');
  const base = `${d}${m}${y}${c.tipoComprobante}${c.ruc}${c.ambiente}${c.establecimiento}${c.puntoEmision}${c.secuencial}${c.codigoNumerico}1`;
  if (!/^\d{48}$/.test(base)) throw new Error(`Clave de acceso inválida (${base.length} dígitos): revise RUC, serie, secuencial y código numérico.`);
  return `${base}${modulo11(base)}`;
}

export const isValidClaveAcceso = (clave: string) => /^\d{49}$/.test(clave) && modulo11(clave.slice(0, 48)) === Number(clave[48]);
