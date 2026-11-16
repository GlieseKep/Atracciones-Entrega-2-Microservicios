import { parseProfile } from './profile-input';

const valid = { tipo_identificacion: 'CEDULA', identificacion: '1710034065', razon_social: 'Ana Pérez', correo: 'ANA@correo.com', es_principal: true };

describe('ms-billing-profile/profile-input · perfil de facturación', () => {
  it('perfil principal válido con correo normalizado', () => {
    expect(parseProfile(valid)).toEqual({ tipo_identificacion: 'CEDULA', identificacion: '1710034065', razon_social: 'Ana Pérez', correo: 'ana@correo.com', telefono: null, es_principal: true });
  });

  it('documento inválido según su tipo → 400 en identificacion', () => {
    expect(() => parseProfile({ ...valid, identificacion: '1710034064' })).toThrow(expect.objectContaining({ invalidParams: [expect.objectContaining({ name: 'identificacion' })] }));
    expect(() => parseProfile({ ...valid, tipo_identificacion: 'RUC', identificacion: '123' })).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('consumidor final sin identificación toma el código del SRI; es_principal no booleano → 400', () => {
    expect(parseProfile({ ...valid, tipo_identificacion: 'CONSUMIDOR_FINAL', identificacion: '' }).identificacion).toMatch(/^9+$/);
    expect(() => parseProfile({ ...valid, es_principal: 'si' })).toThrow(expect.objectContaining({ invalidParams: [expect.objectContaining({ name: 'es_principal' })] }));
  });
});
