import { AppError, payloadHash } from '@atracciones/platform';
import type { IdempotencyRepository, IdempotencySubject } from '../persistence/idempotency-repository';

/** Ejecuta `work` una sola vez por clave y sujeto: repetir la misma solicitud devuelve la respuesta guardada, por 24 horas. */
export async function onceByKey<T>(
  repository: IdempotencyRepository,
  clave: string,
  subject: IdempotencySubject,
  operacion: string,
  request: unknown,
  work: () => Promise<T>,
): Promise<T> {
  const reservation = await repository.reserve<T>(clave, subject, operacion, payloadHash(request));
  if (reservation.state === 'done') return reservation.response;
  if (reservation.state === 'reused') throw AppError.conflict('IDEMPOTENCY_KEY_REUSED', 'La clave ya se usó con otra solicitud.');
  if (reservation.state === 'in_progress') throw AppError.conflict('IDEMPOTENCY_IN_PROGRESS', 'La misma solicitud todavía está en proceso.');
  try {
    const response = await work();
    await repository.complete(clave, subject, response);
    return response;
  } catch (error) {
    await repository.fail(clave, subject);
    throw error;
  }
}
