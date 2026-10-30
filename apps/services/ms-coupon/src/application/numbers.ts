/** Hasta dos decimales, tolerando el error de punto flotante (`15.1 * 100` = 1510.0000000000002). */
export const hasAtMostTwoDecimals = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
