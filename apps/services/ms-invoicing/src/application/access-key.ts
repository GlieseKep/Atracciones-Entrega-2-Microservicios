import { randomInt } from 'node:crypto';
import { claveAcceso } from '@atracciones/platform';
import type { Issuer } from '../contract';

export const ESTABLECIMIENTO = '001';
export const PUNTO_EMISION = '001';

export const formatSequential = (value: number) => String(value).padStart(9, '0');

export const invoiceNumber = (secuencial: string) => `${ESTABLECIMIENTO}-${PUNTO_EMISION}-${secuencial}`;

/** Clave de 49 dígitos, con dígito verificador módulo 11, para una factura (`01`). */
export const accessKey = (issuer: Issuer, fecha: string, secuencial: string) =>
  claveAcceso({
    fecha,
    tipoComprobante: '01',
    ruc: issuer.ruc,
    ambiente: issuer.ambiente,
    establecimiento: ESTABLECIMIENTO,
    puntoEmision: PUNTO_EMISION,
    secuencial,
    codigoNumerico: String(randomInt(100_000_000)).padStart(8, '0'),
  });
