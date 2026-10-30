import { randomUUID } from 'node:crypto';
import { isValidClaveAcceso } from '@atracciones/platform';
import request from 'supertest';
import { reservar, reservaBody } from './booking-flow';
import { startSystem, type System } from './harness';

/** Fase 6 (plan §8): facturación electrónica con el SRI (SOAP a través del ESB), fuera del camino de la compra. */
describe('Fase 6 — Facturación electrónica (SRI)', () => {
  let system: System;
  let apiKey: string;

  const ordenId = async (externalOrderId: string) =>
    (await system.databases.order!.query(`SELECT id FROM orden WHERE codigo_externo = $1`, [externalOrderId]))[0].id as string;
  const facturasDe = (orden: string) =>
    system.databases.invoicing!.query(
      `SELECT f.id, f.tipo_comprobante, f.estado_sri, f.clave_acceso, f.numero_autorizacion, f.comprador_identificacion, f.comprador_tipo_identificacion,
              f.factura_origen_id, f.intentos, t.subtotal_con_iva, t.iva, t.total
         FROM factura f JOIN v_factura_totales t ON t.factura_id = f.id WHERE f.orden_id = $1 ORDER BY f.creado_en`,
      [orden],
    );

  beforeAll(async () => {
    system = await startSystem({ events: true });
    apiKey = (await system.identity.accounts.createApiKey({ nombre: 'booking-prototipo', email: 'integracion@booking.test' })).apiKey;
  });
  afterAll(async () => {
    await system?.close();
  });

  it('una compra termina con una factura AUTORIZADA por el SRI, con el correlation_id en el SOAP Header', async () => {
    const res = await reservar(system, apiKey, reservaBody()).set('X-Correlation-Id', 'cid-factura-fase6').expect(201);
    await system.pumpEvents();
    const [factura] = await facturasDe(await ordenId(res.body.external_order_id));
    expect(factura).toEqual(expect.objectContaining({
      tipo_comprobante: 'FACTURA', estado_sri: 'AUTORIZADA', comprador_identificacion: '1710034065', comprador_tipo_identificacion: '05',
    }));
    expect(isValidClaveAcceso(factura.clave_acceso)).toBe(true);
    expect(factura.numero_autorizacion).toBe(factura.clave_acceso);
    // 75 USD con IVA del 15 % incluido, redondeado por línea: (52,17 + 7,83) + (13,04 + 1,96).
    expect({ base: Number(factura.subtotal_con_iva), iva: Number(factura.iva), total: Number(factura.total) }).toEqual({ base: 65.21, iva: 9.79, total: 75 });

    const enviado = system.sriMock!.received.find((r) => r.claveAcceso === factura.clave_acceso)!;
    expect(enviado.correlationId).toBe('cid-factura-fase6');
    expect(enviado.xml).toContain('<factura id="comprobante" version="1.1.0">');
    expect(enviado.xml).toContain('<totalImpuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><baseImponible>65.21</baseImponible><valor>9.79</valor></totalImpuesto>');
    expect(enviado.xml).toContain('<importeTotal>75.00</importeTotal>');
    const [{ n }] = await system.databases.audit!.query(`SELECT count(*)::int AS n FROM bitacora WHERE tipo_evento = 'FacturaAutorizada' AND correlation_id = 'cid-factura-fase6'`);
    expect(n).toBe(1);
  });

  it('con el SRI caído la compra no se afecta y la factura se autoriza al volver (reintento exponencial)', async () => {
    system.sriMock!.setDown(true);
    const res = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 })).expect(201);
    await system.pumpEvents();
    const orden = await ordenId(res.body.external_order_id);
    const [pendiente] = await facturasDe(orden);
    expect(pendiente).toEqual(expect.objectContaining({ estado_sri: 'PENDIENTE', intentos: expect.any(Number) }));
    expect(pendiente.intentos).toBeGreaterThan(0);

    system.sriMock!.setDown(false);
    await system.databases.invoicing!.query(`UPDATE factura SET proximo_intento_en = now() WHERE estado_sri <> 'AUTORIZADA'`);
    await system.pumpEvents();
    const [autorizada] = await facturasDe(orden);
    expect(autorizada.estado_sri).toBe('AUTORIZADA');
  });

  it('una cancelación con reembolso emite una nota de crédito AUTORIZADA sobre la factura', async () => {
    const res = await reservar(system, apiKey, reservaBody({ adult_count: 1, child_count: 0 })).expect(201);
    await system.pumpEvents();
    await request(system.gatewayUrl).post(`/api/v2/atracciones/reservas/${res.body.reservation_id}/cancel`)
      .set('X-API-Key', apiKey).set('Idempotency-Key', randomUUID()).send({ solicitante: 'SAGA_ORCHESTRATOR' }).expect(200);
    await system.pumpEvents();
    const [factura, nota] = await facturasDe(await ordenId(res.body.external_order_id));
    expect(nota).toEqual(expect.objectContaining({ tipo_comprobante: 'NOTA_CREDITO', estado_sri: 'AUTORIZADA', factura_origen_id: factura.id }));
    expect(Number(nota.total)).toBe(30);
    const xml = system.sriMock!.received.find((r) => r.claveAcceso === nota.clave_acceso)!.xml;
    expect(xml).toContain('<notaCredito id="comprobante" version="1.1.0">');
    expect(xml).toContain('<codDocModificado>01</codDocModificado>');
    expect(system.bus.deadLetters).toEqual([]);
  });
});
