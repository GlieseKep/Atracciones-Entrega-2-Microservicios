import { money } from '@atracciones/platform';

/** Datos del emisor (la tienda) que van en `infoTributaria`. */
export interface Emisor {
  ambiente: '1' | '2';
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  dirMatriz: string;
  dirEstablecimiento: string;
  establecimiento: string;
  puntoEmision: string;
  obligadoContabilidad: 'SI' | 'NO';
}

export interface Comprador {
  tipoIdentificacion: string;
  identificacion: string;
  razonSocial: string;
  email: string | null;
  direccion: string | null;
}

export interface Linea {
  codigoPrincipal: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  /** Código de tarifa de IVA del SRI (`0` = 0 %, `4` = 15 %) y su porcentaje. */
  codigoTarifaIva: string;
  porcentajeIva: number;
}

const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n2 = (v: number) => money(v).toFixed(2);
const fechaSri = (iso: string) => iso.split('-').reverse().join('/');

/** Base e IVA de una línea, redondeados a centavos (los totales son la suma de las líneas, así cuadran con lo cobrado). */
const importes = (l: Linea) => {
  const base = money(l.cantidad * l.precioUnitario - l.descuento);
  return { base, valor: money((base * l.porcentajeIva) / 100) };
};

/** Totales por tarifa de IVA (`totalConImpuestos`). */
function totales(lineas: Linea[]) {
  const grupos = new Map<string, { base: number; valor: number }>();
  for (const l of lineas) {
    const { base, valor } = importes(l);
    const g = grupos.get(l.codigoTarifaIva) ?? { base: 0, valor: 0 };
    grupos.set(l.codigoTarifaIva, { base: money(g.base + base), valor: money(g.valor + valor) });
  }
  const impuestos = [...grupos].map(([codigo, g]) => ({ codigo, base: g.base, valor: g.valor }));
  const sinImpuestos = money(impuestos.reduce((s, i) => s + i.base, 0));
  const iva = money(impuestos.reduce((s, i) => s + i.valor, 0));
  return { impuestos, sinImpuestos, iva, total: money(sinImpuestos + iva) };
}

function infoTributaria(e: Emisor, codDoc: '01' | '04', claveAcceso: string, secuencial: string): string {
  return `<infoTributaria><ambiente>${e.ambiente}</ambiente><tipoEmision>1</tipoEmision><razonSocial>${escape(e.razonSocial)}</razonSocial>`
    + `<nombreComercial>${escape(e.nombreComercial)}</nombreComercial><ruc>${e.ruc}</ruc><claveAcceso>${claveAcceso}</claveAcceso><codDoc>${codDoc}</codDoc>`
    + `<estab>${e.establecimiento}</estab><ptoEmi>${e.puntoEmision}</ptoEmi><secuencial>${secuencial}</secuencial><dirMatriz>${escape(e.dirMatriz)}</dirMatriz></infoTributaria>`;
}

function detalles(lineas: Linea[]): string {
  return lineas.map((l) => {
    const { base, valor } = importes(l);
    return `<detalle><codigoPrincipal>${escape(l.codigoPrincipal)}</codigoPrincipal><descripcion>${escape(l.descripcion)}</descripcion>`
      + `<cantidad>${l.cantidad.toFixed(2)}</cantidad><precioUnitario>${l.precioUnitario.toFixed(6)}</precioUnitario><descuento>${n2(l.descuento)}</descuento>`
      + `<precioTotalSinImpuesto>${n2(base)}</precioTotalSinImpuesto><impuestos><impuesto><codigo>2</codigo><codigoPorcentaje>${l.codigoTarifaIva}</codigoPorcentaje>`
      + `<tarifa>${l.porcentajeIva.toFixed(2)}</tarifa><baseImponible>${n2(base)}</baseImponible><valor>${n2(valor)}</valor></impuesto></impuestos></detalle>`;
  }).join('');
}

const totalConImpuestos = (t: ReturnType<typeof totales>) =>
  t.impuestos.map((i) => `<totalImpuesto><codigo>2</codigo><codigoPorcentaje>${i.codigo}</codigoPorcentaje><baseImponible>${n2(i.base)}</baseImponible><valor>${n2(i.valor)}</valor></totalImpuesto>`).join('');

/** Factura electrónica (codDoc 01), versión 1.1.0 de la ficha técnica del SRI. */
export function facturaXml(e: Emisor, c: Comprador, lineas: Linea[], fecha: string, claveAcceso: string, secuencial: string, formaPago: string): string {
  const t = totales(lineas);
  return `<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante" version="1.1.0">${infoTributaria(e, '01', claveAcceso, secuencial)}`
    + `<infoFactura><fechaEmision>${fechaSri(fecha)}</fechaEmision><dirEstablecimiento>${escape(e.dirEstablecimiento)}</dirEstablecimiento>`
    + `<obligadoContabilidad>${e.obligadoContabilidad}</obligadoContabilidad><tipoIdentificacionComprador>${c.tipoIdentificacion}</tipoIdentificacionComprador>`
    + `<razonSocialComprador>${escape(c.razonSocial)}</razonSocialComprador><identificacionComprador>${c.identificacion}</identificacionComprador>`
    + (c.direccion ? `<direccionComprador>${escape(c.direccion)}</direccionComprador>` : '')
    + `<totalSinImpuestos>${n2(t.sinImpuestos)}</totalSinImpuestos><totalDescuento>0.00</totalDescuento><totalConImpuestos>${totalConImpuestos(t)}</totalConImpuestos>`
    + `<propina>0.00</propina><importeTotal>${n2(t.total)}</importeTotal><moneda>DOLAR</moneda>`
    + `<pagos><pago><formaPago>${formaPago}</formaPago><total>${n2(t.total)}</total></pago></pagos></infoFactura>`
    + `<detalles>${detalles(lineas)}</detalles>`
    + (c.email ? `<infoAdicional><campoAdicional nombre="Email">${escape(c.email)}</campoAdicional></infoAdicional>` : '')
    + `</factura>`;
}

/** Nota de crédito (codDoc 04), versión 1.1.0: devuelve total o parcialmente una factura autorizada. */
export function notaCreditoXml(
  e: Emisor,
  c: Comprador,
  lineas: Linea[],
  fecha: string,
  claveAcceso: string,
  secuencial: string,
  sustento: { numero: string; fecha: string; motivo: string },
): string {
  const t = totales(lineas);
  return `<?xml version="1.0" encoding="UTF-8"?><notaCredito id="comprobante" version="1.1.0">${infoTributaria(e, '04', claveAcceso, secuencial)}`
    + `<infoNotaCredito><fechaEmision>${fechaSri(fecha)}</fechaEmision><dirEstablecimiento>${escape(e.dirEstablecimiento)}</dirEstablecimiento>`
    + `<tipoIdentificacionComprador>${c.tipoIdentificacion}</tipoIdentificacionComprador><razonSocialComprador>${escape(c.razonSocial)}</razonSocialComprador>`
    + `<identificacionComprador>${c.identificacion}</identificacionComprador><obligadoContabilidad>${e.obligadoContabilidad}</obligadoContabilidad>`
    + `<codDocModificado>01</codDocModificado><numDocModificado>${sustento.numero}</numDocModificado><fechaEmisionDocSustento>${fechaSri(sustento.fecha)}</fechaEmisionDocSustento>`
    + `<totalSinImpuestos>${n2(t.sinImpuestos)}</totalSinImpuestos><valorModificacion>${n2(t.total)}</valorModificacion><moneda>DOLAR</moneda>`
    + `<totalConImpuestos>${totalConImpuestos(t)}</totalConImpuestos><motivo>${escape(sustento.motivo)}</motivo></infoNotaCredito>`
    // En la nota de crédito el código del ítem se llama `codigoInterno`.
    + `<detalles>${detalles(lineas).replace(/<codigoPrincipal>/g, '<codigoInterno>').replace(/<\/codigoPrincipal>/g, '</codigoInterno>')}</detalles>`
    + `</notaCredito>`;
}
