import type { EsbClient } from '@atracciones/platform';
import type {
  ModerationPageDto,
  RatingSummaryDto,
  ReviewCreateRequestDto,
  ReviewDto,
  ReviewHealthDto,
  ReviewPageDto,
  VisibilityRequestDto,
} from '../contract';
import type { ReviewOperation } from './esb-routes';

/**
 * Cliente de Review a través del ESB (operaciones de `MS_REVIEW_ROUTES`). Usa el principal de la petición en curso: el
 * ESB lo reenvía. Los errores llegan como `AppError` con el estado y el código del servicio (p. ej. 422
 * `RESERVATION_NOT_ELIGIBLE`).
 *
 * - GraphQL: reseñas de una atracción, `create` y `listMine` con el JWT del usuario; moderación con rol ADMIN.
 * - Catalog: `getSummary` para reconstruir su proyección de calificaciones si perdió eventos.
 */
export class ReviewClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'review',
  ) {}

  private call<T>(operation: ReviewOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  health(): Promise<ReviewHealthDto> {
    return this.call('health');
  }

  listByAttraction(attractionId: string, options: { sort?: 'RECENT' | 'SCORE_DESC' | 'SCORE_ASC'; page?: number; limit?: number } = {}): Promise<ReviewPageDto> {
    return this.call('listByAttraction', { ...options, attraction_id: attractionId });
  }

  getSummary(attractionId: string): Promise<RatingSummaryDto> {
    return this.call('getSummary', { attraction_id: attractionId });
  }

  create(attractionId: string, review: ReviewCreateRequestDto): Promise<ReviewDto> {
    return this.call('create', { ...review, attraction_id: attractionId });
  }

  listMine(): Promise<ReviewDto[]> {
    return this.call('listMine');
  }

  listForModeration(filters: { visible?: boolean; attraction_id?: string; max_score?: number; page?: number; limit?: number } = {}): Promise<ModerationPageDto> {
    return this.call('listForModeration', filters);
  }

  setVisibility(id: number, change: VisibilityRequestDto): Promise<ReviewDto> {
    return this.call('setVisibility', { ...change, id });
  }
}
