import type { AppError } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';

export type Db = DataSource | EntityManager;

/** Ejecuta `work` y traduce una violación de unicidad (`23505`) al error de su restricción. */
export async function mapUnique<T>(work: () => Promise<T>, errors: Record<string, () => AppError>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const driver = (error as { driverError?: { code?: string; constraint?: string } }).driverError;
    const mapped = driver?.code === '23505' && driver.constraint ? errors[driver.constraint] : undefined;
    throw mapped ? mapped() : error;
  }
}
