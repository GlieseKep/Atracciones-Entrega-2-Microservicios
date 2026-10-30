import { AppError } from '@atracciones/platform';
import { mergeAgreement, parseAgreementUpdate, toAgreementResponse, type Agreement } from './agreement';

const failure = (work: () => unknown) => {
  try {
    work();
    return null;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code, fields: error.invalidParams?.map((p) => p.name) };
    throw error;
  }
};

const current: Agreement = {
  providerCode: 'proveedor-atracciones-dilan',
  commercialName: 'Descubre EC',
  allowsPromotions: false,
  maxDiscount: 0,
  agreementDate: '2026-10-01',
  validUntil: '2027-10-01',
  comboConditions: 'Compra con 48 horas de anticipación.',
  contact: { name: 'Dilan Mendoza', email: 'dilan@descubreec.com', phone: '+593998765432' },
  destinationIds: [1, 2],
};

describe('cuestionario del PUT', () => {
  it('lee las preguntas obligatorias y las opcionales enviadas', () => {
    expect(parseAgreementUpdate({
      permite_promociones: true,
      porcentaje_descuento_maximo: 15.5,
      destinos_habilitados: [' Quito ', 'Baños', 'Quito'],
      vigencia_hasta: '2027-12-31',
      contacto_comercial: { email: 'ventas@descubreec.com' },
    })).toEqual({
      allowsPromotions: true,
      maxDiscount: 15.5,
      destinations: ['Quito', 'Baños'],
      validUntil: '2027-12-31',
      contact: { email: 'ventas@descubreec.com' },
    });
  });

  it('todo error es 400 (el contrato no lista 422 en este PUT)', () => {
    expect(failure(() => parseAgreementUpdate({ porcentaje_descuento_maximo: 10 }))).toEqual({ status: 400, code: 'VALIDATION_ERROR', fields: ['permite_promociones'] });
    expect(failure(() => parseAgreementUpdate({ permite_promociones: true, porcentaje_descuento_maximo: 50.01 }))?.fields).toEqual(['porcentaje_descuento_maximo']);
    expect(failure(() => parseAgreementUpdate({ permite_promociones: true, porcentaje_descuento_maximo: -1 }))?.status).toBe(400);
    expect(failure(() => parseAgreementUpdate({ permite_promociones: true, porcentaje_descuento_maximo: 10.123 }))?.fields).toEqual(['porcentaje_descuento_maximo']);
    expect(failure(() => parseAgreementUpdate({ permite_promociones: true, porcentaje_descuento_maximo: 10, destinos_habilitados: 'Quito' }))?.fields).toEqual(['destinos_habilitados']);
    expect(failure(() => parseAgreementUpdate({ permite_promociones: true, porcentaje_descuento_maximo: 10, vigencia_hasta: '2027-02-30' }))?.fields).toEqual(['vigencia_hasta']);
    expect(failure(() => parseAgreementUpdate({ permite_promociones: true, porcentaje_descuento_maximo: 10, contacto_comercial: { email: 'no-es-correo', telefono: '123' } }))?.fields)
      .toEqual(['contacto_comercial.email', 'contacto_comercial.telefono']);
  });

  it('15.1 tiene dos decimales aunque 15.1 × 100 no sea exacto en punto flotante', () => {
    expect(parseAgreementUpdate({ permite_promociones: true, porcentaje_descuento_maximo: 15.1 }).maxDiscount).toBe(15.1);
  });
});

describe('merge del acuerdo', () => {
  it('reemplaza las obligatorias, conserva las opcionales omitidas y formaliza hoy', () => {
    const merged = mergeAgreement(current, { allowsPromotions: true, maxDiscount: 15 }, '2026-10-25');
    expect(merged).toEqual({ ...current, allowsPromotions: true, maxDiscount: 15, agreementDate: '2026-10-25' });
  });

  it('los destinos solo cambian si se enviaron', () => {
    expect(mergeAgreement(current, { allowsPromotions: true, maxDiscount: 15, destinations: ['Cuenca'] }, '2026-10-25', [3]).destinationIds).toEqual([3]);
    expect(mergeAgreement(current, { allowsPromotions: true, maxDiscount: 15, destinations: [] }, '2026-10-25', []).destinationIds).toEqual([]);
  });

  it('el contacto se combina campo por campo y condiciones_combo null la borra', () => {
    const merged = mergeAgreement(current, { allowsPromotions: true, maxDiscount: 15, contact: { phone: '+593990000000' }, comboConditions: null }, '2026-10-25');
    expect(merged.contact).toEqual({ ...current.contact, phone: '+593990000000' });
    expect(merged.comboConditions).toBeNull();
  });

  it('la vigencia no puede terminar antes de hoy', () => {
    expect(failure(() => mergeAgreement(current, { allowsPromotions: true, maxDiscount: 15, validUntil: '2026-10-24' }, '2026-10-25'))).toEqual({ status: 400, code: 'VALIDATION_ERROR', fields: ['vigencia_hasta'] });
    expect(failure(() => mergeAgreement({ ...current, validUntil: '2026-01-01' }, { allowsPromotions: true, maxDiscount: 15 }, '2026-10-25'))?.fields).toEqual(['vigencia_hasta']);
  });
});

describe('PromocionesContratoResponse', () => {
  it('tiene los campos del contrato v3 y omite los opcionales vacíos', () => {
    expect(toAgreementResponse(current, ['Baños', 'Quito'])).toEqual({
      proveedor_id: 'proveedor-atracciones-dilan',
      nombre_comercial: 'Descubre EC',
      permite_promociones: false,
      porcentaje_descuento_maximo: 0,
      destinos_habilitados: ['Baños', 'Quito'],
      fecha_acuerdo: '2026-10-01',
      vigencia_hasta: '2027-10-01',
      condiciones_combo: 'Compra con 48 horas de anticipación.',
    });
    const bare = toAgreementResponse({ ...current, commercialName: null, comboConditions: null }, []);
    expect(bare).not.toHaveProperty('nombre_comercial');
    expect(bare).not.toHaveProperty('condiciones_combo');
  });
});
