import { aliasConflicts, isValidCedula, isValidFullName, isValidPhone, isValidRuc, validateCustomer } from './validation';

describe('validaciones semánticas del contrato (§7.3)', () => {
  it('valida la cédula con el dígito verificador de módulo 10', () => {
    expect(isValidCedula('1723456789')).toBe(false);
    expect(isValidCedula('1710034065')).toBe(true);
    expect(isValidCedula('1710034066')).toBe(false);
    expect(isValidCedula('2510034065')).toBe(false); // provincia 25 no existe
    expect(isValidCedula('171003406')).toBe(false);
  });

  it('valida RUC, teléfono y nombre', () => {
    expect(isValidRuc('1710034065001')).toBe(true);
    expect(isValidRuc('1792348123001')).toBe(true); // sociedad privada (tercer dígito 9)
    expect(isValidRuc('1710034065000')).toBe(false);
    expect(isValidPhone('+593991234567')).toBe(true);
    expect(isValidPhone('0991234567')).toBe(true);
    expect(isValidPhone('991234567')).toBe(false);
    expect(isValidFullName('Paúl Rosero')).toBe(true);
    expect(isValidFullName("María José O'Neil-Ñuñez")).toBe(true);
    expect(isValidFullName('Paúl')).toBe(false);
    expect(isValidFullName('Paul 2')).toBe(false);
  });

  it('acumula todos los errores del titular y usa el código del primero', () => {
    const result = validateCustomer({ full_name: 'Paul', email: 'p@x.ec', phone: '123', document_type: 'CEDULA', document_id: '1723456789' });
    expect(result?.code).toBe('INVALID_DOCUMENT');
    expect(result?.invalid.map((p) => p.name)).toEqual(['customer.document_id', 'customer.phone', 'customer.full_name']);
    expect(validateCustomer({ full_name: 'Paúl Rosero', email: 'p@x.ec', phone: '0991234567', document_type: 'PASAPORTE', document_id: 'AB123456' })).toBeNull();
  });

  it('detecta alias contradictorios solo si se envían ambos', () => {
    expect(aliasConflicts({ adult_count: 2, cantidad_adultos: 3 }, [['adult_count', 'cantidad_adultos']])).toHaveLength(1);
    expect(aliasConflicts({ adult_count: 2 }, [['adult_count', 'cantidad_adultos']])).toEqual([]);
    expect(aliasConflicts({ adult_count: 2, cantidad_adultos: 2 }, [['adult_count', 'cantidad_adultos']])).toEqual([]);
  });
});
