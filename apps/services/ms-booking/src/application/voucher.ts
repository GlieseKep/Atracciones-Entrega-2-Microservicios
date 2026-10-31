import { createHmac, timingSafeEqual } from 'node:crypto';

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

/** Voucher del QR: los datos de la reserva y su firma HMAC-SHA256. */
export function createVoucher(data: { reservationId: string; code: string; document: string }, secret: string): string {
  const body = Buffer.from(JSON.stringify({ res_id: data.reservationId, pnr: data.code, doc: data.document })).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** Firma válida y de esa reserva. */
export function verifyVoucher(voucher: string, reservationId: string, secret: string): boolean {
  const [body, signature] = voucher.split('.');
  if (!body || !signature) return false;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')).res_id === reservationId;
  } catch {
    return false;
  }
}
