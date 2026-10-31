/**
 * Gestiona el `Idempotency-Key` de un intento lógico de mutación (plan §9):
 * - El mismo payload reintentado reutiliza la misma clave.
 * - Un payload distinto, o un intento ya completado, genera una clave nueva.
 */
export class IdempotencyKeyManager {
  private key: string | null = null;
  private fingerprint: string | null = null;

  constructor(private readonly generate: () => string = () => crypto.randomUUID()) {}

  keyFor(payload: unknown): string {
    const fingerprint = stableStringify(payload);
    if (this.key === null || this.fingerprint !== fingerprint) {
      this.key = this.generate();
      this.fingerprint = fingerprint;
    }
    return this.key;
  }

  /** Llamar tras una respuesta definitiva (éxito o error no reintentable). */
  complete(): void {
    this.key = null;
    this.fingerprint = null;
  }
}

/** JSON con claves ordenadas para comparar payloads sin depender del orden. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
