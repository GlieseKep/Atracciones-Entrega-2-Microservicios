import { XMLParser } from 'fast-xml-parser';
import { AppError, currentCorrelationId } from '@atracciones/platform';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Objeto plano → elementos XML sin espacio de nombres (como los parámetros de los servicios del SRI). */
function toElements(input: Record<string, unknown>): string {
  return Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => (typeof v === 'object' ? `<${k}>${toElements(v as Record<string, unknown>)}</${k}>` : `<${k}>${escape(String(v))}</${k}>`))
    .join('');
}

/**
 * Sobre SOAP 1.1 de una operación. El `correlation_id` viaja en el Header (plan D11) sin `mustUnderstand`, así que un
 * servidor que no lo conoce lo ignora; `withCorrelation = false` lo omite por completo.
 */
export function soapEnvelope(namespace: string, operation: string, input: Record<string, unknown>, withCorrelation = true): string {
  const correlation = currentCorrelationId();
  const header = withCorrelation && correlation ? `<atr:CorrelationId xmlns:atr="urn:atracciones:integracion">${escape(correlation)}</atr:CorrelationId>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="${namespace}">`
    + `<soapenv:Header>${header}</soapenv:Header>`
    + `<soapenv:Body><ns:${operation}>${toElements(input)}</ns:${operation}></soapenv:Body>`
    + `</soapenv:Envelope>`;
}

const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, trimValues: true });

/** Contenido de la respuesta de la operación (`<operacionResponse>`), sin espacios de nombres. Un SOAP Fault es un 503/500. */
export function parseSoapResponse(xml: string, operation: string): Record<string, unknown> {
  let document: Record<string, unknown>;
  try {
    document = parser.parse(xml);
  } catch {
    throw AppError.unavailable('El servicio SOAP respondió un XML inválido.');
  }
  const body = (document.Envelope as Record<string, unknown> | undefined)?.Body as Record<string, unknown> | undefined;
  if (!body) throw AppError.unavailable('El servicio SOAP respondió sin Body.');
  if (body.Fault) {
    const fault = body.Fault as Record<string, unknown>;
    throw new AppError(502, 'SOAP_FAULT', `SOAP Fault: ${String(fault.faultstring ?? 'sin detalle')}`);
  }
  const response = body[`${operation}Response`];
  if (!response || typeof response !== 'object') throw AppError.unavailable(`El servicio SOAP no devolvió ${operation}Response.`);
  return response as Record<string, unknown>;
}
