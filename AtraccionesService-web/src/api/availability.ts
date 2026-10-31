import type { IsoDate } from '@/types/api';
import type { Availability } from '@/types/attraction';
import { http } from './client';

/** `GET /atracciones/{id}/availability?date=YYYY-MM-DD` (fecha y horas locales de la atracción). */
export const getAvailability = (attractionId: string, date: IsoDate, signal?: AbortSignal) =>
  http.get<Availability>(`/atracciones/${attractionId}/availability`, { query: { date }, signal });
