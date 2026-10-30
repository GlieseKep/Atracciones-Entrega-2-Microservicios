import type { Principal } from '@atracciones/platform';
import type { Request } from 'express';

export type ContractRequest = Request & {
  principal?: Principal | null;
  openapi?: { openApiRoute?: string };
  /**
   * Cuerpo tal como lo envió el cliente. El validador completa los `default` del contrato (p. ej. `cantidad_adultos: 1`),
   * así que las reglas de alias ES/EN (§7.4) se evalúan sobre esta copia: solo cuenta lo que el cliente envió.
   */
  sentBody?: Record<string, unknown>;
};

/** Valor de un campo con alias: el enviado en inglés, o su alias en español, o el valor por defecto. */
export function aliased<T>(sent: Record<string, unknown> | undefined, en: string, es: string, fallback: T): T {
  const value = sent?.[en] ?? sent?.[es];
  return value === undefined ? fallback : (value as T);
}
