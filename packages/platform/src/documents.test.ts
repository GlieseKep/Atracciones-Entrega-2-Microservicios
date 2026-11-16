import { isValidCedula, isValidDocument, isValidPassport, isValidRuc, validateCustomer } from './documents';

// 1710034065: suma módulo 10 = 25 → dígito verificador 5.
const CEDULA = '1710034065';

describe('documents · documentos del titular (P7, P10)', () => {
  it('cédula válida', () => {
    expect(isValidCedula(CEDULA)).toBe(true);
  });

  it('cédula con dígito verificador erróneo', () => {
    expect(isValidCedula('1710034064')).toBe(false);
  });

  it('cédula con provincia inexistente (25) y provincia 30 del exterior', () => {
    expect(isValidCedula('2510034065')).toBe(false);
    // 30 (ecuatorianos en el exterior) es válida: 3010034068 suma 22 → verificador 8.
    expect(isValidCedula('3010034068')).toBe(true);
    expect(isValidCedula('0010034065')).toBe(false);
  });

  it('cédula con tercer dígito 6 o mayor no es persona natural', () => {
    expect(isValidCedula('1760034065')).toBe(false);
  });

  it('cédula con longitud o caracteres incorrectos', () => {
    for (const bad of ['171003406', '17100340650', '17100340a5', '']) expect(isValidCedula(bad)).toBe(false);
  });

  it('RUC de persona natural: cédula válida + establecimiento', () => {
    expect(isValidRuc(`${CEDULA}001`)).toBe(true);
    expect(isValidRuc(`${CEDULA}000`)).toBe(false);
    expect(isValidRuc('1710034064001')).toBe(false);
  });

  it('RUC privado (9) y público (6); otro tercer dígito no', () => {
    expect(isValidRuc('1790012345001')).toBe(true);
    expect(isValidRuc('1760012345001')).toBe(true);
    expect(isValidRuc('1780012345001')).toBe(false);
  });

  it('pasaporte: 6 a 9 caracteres alfanuméricos', () => {
    expect(isValidPassport('AB123456')).toBe(true);
    expect(isValidPassport('AB12')).toBe(false);
    expect(isValidPassport('AB-12345')).toBe(false);
  });

  it('isValidDocument según el tipo; tipo desconocido o vacío no es válido', () => {
    expect(isValidDocument('CEDULA', CEDULA)).toBe(true);
    expect(isValidDocument('PASAPORTE', 'AB123456')).toBe(true);
    expect(isValidDocument('PASAPORTE', CEDULA)).toBe(false);
    expect(isValidDocument('LICENCIA', CEDULA)).toBe(false);
    expect(isValidDocument('CEDULA', '')).toBe(false);
  });

  it('validateCustomer devuelve el código del primer error y todos los parámetros inválidos', () => {
    const ok = { full_name: 'Ana Pérez', email: 'ana@correo.com', phone: '0991234567', document_type: 'CEDULA', document_id: CEDULA };
    expect(validateCustomer(ok)).toBeNull();
    const result = validateCustomer({ ...ok, document_id: '1710034064', phone: '12345', full_name: 'Ana' });
    expect(result?.code).toBe('INVALID_DOCUMENT');
    expect(result?.invalid.map((p) => p.name)).toEqual(['customer.document_id', 'customer.phone', 'customer.full_name']);
    expect(validateCustomer({ ...ok, email: 'sin-arroba' })).toBeNull();
    expect(validateCustomer({ ...ok, email: 'sin-arroba' }, { checkEmail: true })?.code).toBe('INVALID_EMAIL');
  });
});
