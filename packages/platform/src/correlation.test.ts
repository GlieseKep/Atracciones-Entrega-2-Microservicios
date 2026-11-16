import { acceptCorrelationId, contextFromHeaders, currentCorrelationId, propagationHeaders, runWithContext } from './correlation';

describe('correlation · X-Correlation-Id (T2)', () => {
  it('reutiliza el X-Correlation-Id recibido', () => {
    const context = contextFromHeaders((name) => ({ 'x-correlation-id': 'booking-abc-123' } as Record<string, string>)[name]);
    expect(context.correlationId).toBe('booking-abc-123');
  });

  it('genera uno nuevo si falta', () => {
    const context = contextFromHeaders(() => undefined);
    expect(context.correlationId).toMatch(/^cid-[0-9a-f-]{36}$/);
  });

  it('descarta uno inválido (espacios, vacío o más de 100 caracteres) y genera otro', () => {
    expect(acceptCorrelationId('con espacio')).toBeNull();
    expect(acceptCorrelationId('')).toBeNull();
    expect(acceptCorrelationId('x'.repeat(101))).toBeNull();
    expect(acceptCorrelationId(['primero', 'segundo'])).toBe('primero');
    const context = contextFromHeaders(() => 'con espacio');
    expect(context.correlationId).toMatch(/^cid-/);
  });

  it('lo propaga al contexto y a las cabeceras de las llamadas salientes', () => {
    const headers = runWithContext({ correlationId: 'cid-xyz', principalToken: 'tok', idempotencyKey: 'k-1', nodeId: null }, () => {
      expect(currentCorrelationId()).toBe('cid-xyz');
      return propagationHeaders();
    });
    expect(headers).toEqual({ 'x-correlation-id': 'cid-xyz', 'x-internal-principal': 'tok', 'idempotency-key': 'k-1' });
    expect(propagationHeaders(undefined)).toEqual({});
  });
});
