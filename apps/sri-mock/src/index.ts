import { XMLParser } from 'fast-xml-parser';
import express, { type Express } from 'express';
import { isValidClaveAcceso, listen, type RunningServer } from '@atracciones/platform';

/**
 * Simulador de los web services offline del SRI (ambiente de pruebas), con las mismas operaciones, espacios de nombres
 * y respuestas: `validarComprobante` (recepción) y `autorizacionComprobante` (autorización).
 * No verifica la firma XAdES-BES (el SRI real sí: sin certificado del emisor responde "FIRMA INVALIDA").
 */
export interface SriMock {
  url: string;
  recepcionUrl: string;
  autorizacionUrl: string;
  /** Comprobantes recibidos, con el `correlation_id` que llegó en el SOAP Header (si vino). */
  received: { claveAcceso: string; xml: string; correlationId: string | null }[];
  /** Simula una caída (HTTP 503) para probar los reintentos. */
  setDown(down: boolean): void;
  close(): Promise<void>;
}

const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false });
const respond = (ns: string, operation: string, content: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>`
  + `<ns2:${operation}Response xmlns:ns2="${ns}">${content}</ns2:${operation}Response></soap:Body></soap:Envelope>`;

const mensaje = (identificador: string, texto: string, tipo = 'ERROR') =>
  `<mensaje><identificador>${identificador}</identificador><mensaje>${texto}</mensaje><tipo>${tipo}</tipo></mensaje>`;

export function createSriMockApp(state: { received: SriMock['received']; down: boolean }): Express {
  const app = express();
  app.use(express.text({ type: '*/*', limit: '2mb' }));
  const authorized = new Map<string, { fecha: string; xml: string }>();

  app.use((_req, res, next) => (state.down ? res.status(503).send('Servicio no disponible (simulado)') : next()));

  app.post('/comprobantes-electronicos-ws/RecepcionComprobantesOffline', (req, res) => {
    const NS = 'http://ec.gob.sri.ws.recepcion';
    const soap = parser.parse(String(req.body)).Envelope;
    const body = soap?.Body?.validarComprobante;
    const correlationId = soap?.Header?.CorrelationId ? String(soap.Header.CorrelationId) : null;
    const xml = Buffer.from(String(body?.xml ?? ''), 'base64').toString('utf8');
    const clave = String(parser.parse(xml)?.factura?.infoTributaria?.claveAcceso ?? parser.parse(xml)?.notaCredito?.infoTributaria?.claveAcceso ?? '');
    res.type('text/xml');
    const devuelta = (identificador: string, texto: string) =>
      res.send(respond(NS, 'validarComprobante', `<RespuestaRecepcionComprobante><estado>DEVUELTA</estado><comprobantes><comprobante><claveAcceso>${clave}</claveAcceso><mensajes>${mensaje(identificador, texto)}</mensajes></comprobante></comprobantes></RespuestaRecepcionComprobante>`));
    if (!isValidClaveAcceso(clave)) return void devuelta('35', 'ARCHIVO NO CUMPLE ESTRUCTURA XML');
    if (state.received.some((r) => r.claveAcceso === clave)) return void devuelta('43', 'CLAVE ACCESO REGISTRADA');
    state.received.push({ claveAcceso: clave, xml, correlationId });
    authorized.set(clave, { fecha: new Date().toISOString(), xml });
    res.send(respond(NS, 'validarComprobante', '<RespuestaRecepcionComprobante><estado>RECIBIDA</estado><comprobantes/></RespuestaRecepcionComprobante>'));
  });

  app.post('/comprobantes-electronicos-ws/AutorizacionComprobantesOffline', (req, res) => {
    const NS = 'http://ec.gob.sri.ws.autorizacion';
    const clave = String(parser.parse(String(req.body)).Envelope?.Body?.autorizacionComprobante?.claveAccesoComprobante ?? '');
    const found = authorized.get(clave);
    const autorizaciones = found
      ? `<autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>${clave}</numeroAutorizacion><fechaAutorizacion>${found.fecha}</fechaAutorizacion><ambiente>PRUEBAS</ambiente><comprobante><![CDATA[${found.xml}]]></comprobante><mensajes/></autorizacion>`
      : '';
    res.type('text/xml').send(respond(NS, 'autorizacionComprobante',
      `<RespuestaAutorizacionComprobante><claveAccesoConsultada>${clave}</claveAccesoConsultada><numeroComprobantes>${found ? 1 : 0}</numeroComprobantes><autorizaciones>${autorizaciones}</autorizaciones></RespuestaAutorizacionComprobante>`));
  });
  return app;
}

export async function startSriMock(port = 4091): Promise<SriMock> {
  const state = { received: [] as SriMock['received'], down: false };
  const server: RunningServer = await listen(createSriMockApp(state), port, '127.0.0.1');
  return {
    url: server.url,
    recepcionUrl: `${server.url}/comprobantes-electronicos-ws/RecepcionComprobantesOffline`,
    autorizacionUrl: `${server.url}/comprobantes-electronicos-ws/AutorizacionComprobantesOffline`,
    received: state.received,
    setDown: (down) => {
      state.down = down;
    },
    close: server.close,
  };
}
