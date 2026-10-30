import { claveAcceso, isValidClaveAcceso, modulo11 } from './sri';

describe('clave de acceso del SRI', () => {
  it('arma los 49 dígitos con el dígito verificador módulo 11', () => {
    const clave = claveAcceso({
      fecha: '2026-10-25', tipoComprobante: '01', ruc: '1792348123001', ambiente: '1',
      establecimiento: '001', puntoEmision: '001', secuencial: '000000001', codigoNumerico: '12345678',
    });
    expect(clave).toMatch(/^25102026011792348123001100100100000000112345678\d{2}$/);
    expect(clave).toHaveLength(49);
    expect(isValidClaveAcceso(clave)).toBe(true);
    expect(isValidClaveAcceso(`${clave.slice(0, 48)}${(Number(clave[48]) + 1) % 10}`)).toBe(false);
  });

  it('aplica las reglas especiales del módulo 11 (11 → 0, 10 → 1)', () => {
    expect(modulo11('0')).toBe(0); // suma 0 → 11 → 0
    expect(modulo11('41261533')).toBe(6);
  });
});
