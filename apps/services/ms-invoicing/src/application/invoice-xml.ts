import { money } from '@atracciones/platform';
import type { FacturaDetalle, IdType, Issuer } from '../contract';
import { ESTABLECIMIENTO, PUNTO_EMISION } from './access-key';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const amount = (value: number) => money(value).toFixed(2);

const ID_CODES: Record<IdType, string> = { RUC: '04', CEDULA: '05', PASAPORTE: '06', CONSUMIDOR_FINAL: '07' };

/** Código del SRI para la tarifa de IVA. */
const taxCode = (porcentaje: number) => (porcentaje === 15 ? '4' : porcentaje === 0 ? '0' : '2');

/**
 * Comprobante con el formato del SRI. La firma es simulada, porque la real exige un certificado digital. No se guarda: se
 * puede volver a generar con los datos de la factura.
 */
export function invoiceXml(factura: FacturaDetalle, issuer: Issuer): string {
  const secuencial = factura.numero.split('-')[2];
  const fecha = factura.emitida_en.slice(0, 10).split('-').reverse().join('/');
  const porcentaje = factura.detalle[0]?.iva_porcentaje ?? 0;
  const code = taxCode(porcentaje);
  const detalles = factura.detalle
    .map(
      (line) =>
        `<detalle><codigoPrincipal>${escape(line.codigo)}</codigoPrincipal><descripcion>${escape(line.descripcion)}</descripcion>`
        + `<cantidad>${line.cantidad.toFixed(2)}</cantidad><precioUnitario>${line.precio_unitario.toFixed(6)}</precioUnitario><descuento>${amount(line.descuento)}</descuento>`
        + `<precioTotalSinImpuesto>${amount(line.subtotal)}</precioTotalSinImpuesto><impuestos><impuesto><codigo>2</codigo><codigoPorcentaje>${code}</codigoPorcentaje>`
        + `<tarifa>${line.iva_porcentaje.toFixed(2)}</tarifa><baseImponible>${amount(line.subtotal)}</baseImponible><valor>${amount(line.iva)}</valor></impuesto></impuestos></detalle>`,
    )
    .join('');
  const base = money(factura.subtotal - factura.descuento);
  return `<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante" version="1.1.0"><infoTributaria><ambiente>${issuer.ambiente}</ambiente><tipoEmision>1</tipoEmision>`
    + `<razonSocial>${escape(issuer.razonSocial)}</razonSocial><ruc>${issuer.ruc}</ruc><claveAcceso>${factura.clave_acceso ?? ''}</claveAcceso><codDoc>01</codDoc>`
    + `<estab>${ESTABLECIMIENTO}</estab><ptoEmi>${PUNTO_EMISION}</ptoEmi><secuencial>${secuencial}</secuencial><dirMatriz>${escape(issuer.direccion)}</dirMatriz></infoTributaria>`
    + `<infoFactura><fechaEmision>${fecha}</fechaEmision><tipoIdentificacionComprador>${ID_CODES[factura.tipo_identificacion]}</tipoIdentificacionComprador>`
    + `<razonSocialComprador>${escape(factura.razon_social)}</razonSocialComprador><identificacionComprador>${factura.identificacion}</identificacionComprador>`
    + `<totalSinImpuestos>${amount(base)}</totalSinImpuestos><totalDescuento>${amount(factura.descuento)}</totalDescuento>`
    + `<totalConImpuestos><totalImpuesto><codigo>2</codigo><codigoPorcentaje>${code}</codigoPorcentaje><baseImponible>${amount(base)}</baseImponible><valor>${amount(factura.iva)}</valor></totalImpuesto></totalConImpuestos>`
    + `<propina>0.00</propina><importeTotal>${amount(factura.total)}</importeTotal><moneda>DOLAR</moneda></infoFactura><detalles>${detalles}</detalles>`
    + `<infoAdicional><campoAdicional nombre="Email">${escape(factura.correo)}</campoAdicional></infoAdicional><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SIMULADA</ds:Signature></factura>`;
}
