import { AppError, type InvalidParam } from '@atracciones/platform';
import type { BreakdownDto } from '../contract';

export interface ReviewCreate {
  reservationId: string;
  score: number;
  breakdown: BreakdownDto;
  comment: string | null;
}

export type ReviewSort = 'RECENT' | 'SCORE_DESC' | 'SCORE_ASC';

export interface PageFilters {
  page: number;
  limit: number;
}

export interface ModerationFilters extends PageFilters {
  visible: boolean | null;
  attractionId: string | null;
  maxScore: number | null;
}

export interface Visibility {
  visible: boolean;
  reason: string | null;
}

const ATTRACTION_ID = /^[A-Za-z0-9]{12}$/;
const PILLARS = ['limpieza', 'servicio', 'calidad_precio', 'puntualidad'] as const;
const SORTS: ReviewSort[] = ['RECENT', 'SCORE_DESC', 'SCORE_ASC'];

const asObject = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw AppError.validation('El cuerpo debe ser un objeto JSON.');
  return body as Record<string, unknown>;
};

/** Primer valor de un parámetro de query (`?a=1&a=2` → `'1'`). */
const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

/** Nota de 1 a 10 con a lo sumo un decimal (`numeric(3,1)`). */
const isScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;

const SCORE_REASON = 'Número entre 1 y 10, con un decimal como máximo.';

/** Código público de la atracción de la ruta; 400 si no tiene el formato del contrato. */
export function parseAttractionId(raw: string): string {
  if (!ATTRACTION_ID.test(raw)) {
    throw AppError.validation('La atracción no es válida.', [{ name: 'attraction_id', reason: 'Código público de 12 letras o dígitos.' }]);
  }
  return raw;
}

/** ID de reseña de la ruta; `null` si no es un número válido (la ruta responde 404). */
export function parseReviewId(raw: string): number | null {
  const id = Number(raw);
  return /^[0-9]+$/.test(raw) && Number.isSafeInteger(id) && id >= 1 ? id : null;
}

/** `ReviewCreateRequest`. */
export function parseReviewCreate(value: unknown): ReviewCreate {
  const body = asObject(value);
  const invalid: InvalidParam[] = [];
  const reservationId = typeof body.reservation_id === 'string' ? body.reservation_id.trim() : '';
  if (!reservationId || reservationId.length > 40) invalid.push({ name: 'reservation_id', reason: 'Identificador o código (PNR) de la reserva.' });
  if (!isScore(body.score)) invalid.push({ name: 'score', reason: SCORE_REASON });
  const breakdown = body.breakdown;
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) {
    invalid.push({ name: 'breakdown', reason: `Objeto con ${PILLARS.join(', ')}.` });
  } else {
    for (const pillar of PILLARS) {
      if (!isScore((breakdown as Record<string, unknown>)[pillar])) invalid.push({ name: `breakdown.${pillar}`, reason: SCORE_REASON });
    }
  }
  let comment: string | null = null;
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== 'string' || body.comment.length > 1000) invalid.push({ name: 'comment', reason: 'Texto de hasta 1000 caracteres, o null.' });
    else comment = body.comment.trim() || null;
  }
  if (invalid.length) throw AppError.validation('La reseña no es válida.', invalid);
  const b = breakdown as Record<string, number>;
  return {
    reservationId,
    score: body.score as number,
    breakdown: { limpieza: b.limpieza, servicio: b.servicio, calidad_precio: b.calidad_precio, puntualidad: b.puntualidad },
    comment,
  };
}

/** `VisibilityRequest`: ocultar exige un motivo. */
export function parseVisibility(value: unknown): Visibility {
  const body = asObject(value);
  const invalid: InvalidParam[] = [];
  if (typeof body.visible !== 'boolean') invalid.push({ name: 'visible', reason: 'true o false.' });
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') invalid.push({ name: 'reason', reason: 'Texto o null.' });
  else if (reason.length > 300) invalid.push({ name: 'reason', reason: 'Máximo 300 caracteres.' });
  else if (body.visible === false && !reason) invalid.push({ name: 'reason', reason: 'Obligatorio al ocultar una reseña.' });
  if (invalid.length) throw AppError.validation('El cambio de visibilidad no es válido.', invalid);
  return { visible: body.visible as boolean, reason: body.visible ? null : reason };
}

function readInt(raw: unknown, name: string, def: number, max: number, invalid: InvalidParam[]): number {
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    invalid.push({ name, reason: `Entero entre 1 y ${max}.` });
    return def;
  }
  return n;
}

/** Query de `GET /atracciones/{id}/resenas`. */
export function parseListQuery(query: Record<string, unknown>): PageFilters & { sort: ReviewSort } {
  const invalid: InvalidParam[] = [];
  const sortRaw = first(query.sort);
  const sort = (typeof sortRaw === 'string' ? sortRaw.toUpperCase() : 'RECENT') as ReviewSort;
  if (sortRaw !== undefined && !SORTS.includes(sort)) invalid.push({ name: 'sort', reason: `Uno de ${SORTS.join(', ')}.` });
  const page = readInt(first(query.page), 'page', 1, 100_000, invalid);
  const limit = readInt(first(query.limit), 'limit', 10, 50, invalid);
  if (invalid.length) throw AppError.validation('Los filtros no son válidos.', invalid);
  return { sort, page, limit };
}

/** Query de `GET /resenas` (moderación). */
export function parseModerationQuery(query: Record<string, unknown>): ModerationFilters {
  const invalid: InvalidParam[] = [];
  const visibleRaw = first(query.visible);
  let visible: boolean | null = null;
  if (visibleRaw !== undefined) {
    if (visibleRaw === 'true') visible = true;
    else if (visibleRaw === 'false') visible = false;
    else invalid.push({ name: 'visible', reason: 'true o false.' });
  }
  const attractionRaw = first(query.attraction_id);
  let attractionId: string | null = null;
  if (attractionRaw !== undefined) {
    if (typeof attractionRaw !== 'string' || !ATTRACTION_ID.test(attractionRaw)) invalid.push({ name: 'attraction_id', reason: 'Código público de 12 letras o dígitos.' });
    else attractionId = attractionRaw;
  }
  const maxRaw = first(query.max_score);
  let maxScore: number | null = null;
  if (maxRaw !== undefined) {
    const n = Number(maxRaw);
    if (!Number.isFinite(n) || n < 1 || n > 10) invalid.push({ name: 'max_score', reason: 'Número entre 1 y 10.' });
    else maxScore = n;
  }
  const page = readInt(first(query.page), 'page', 1, 100_000, invalid);
  const limit = readInt(first(query.limit), 'limit', 20, 100, invalid);
  if (invalid.length) throw AppError.validation('Los filtros no son válidos.', invalid);
  return { visible, attractionId, maxScore, page, limit };
}
