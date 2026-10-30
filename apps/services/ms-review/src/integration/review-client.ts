import type { EsbClient } from '@atracciones/platform';
import type { ResenaDto, ResenaInput, ResenaPage } from '../contract';
import type { ReviewOperation } from './esb-routes';

/** Cliente de Review a través del ESB (operaciones de `MS_REVIEW_ROUTES`), para GraphQL. */
export class ReviewClient {
  constructor(
    private readonly esb: EsbClient,
    private readonly service = 'review',
  ) {}

  private call<T>(operation: ReviewOperation, input: object = {}): Promise<T> {
    return this.esb.call<T>(this.service, operation, input);
  }

  list(id: string, paging: { page?: number; limit?: number } = {}): Promise<ResenaPage> {
    return this.call('listReviews', { id, ...paging });
  }

  create(id: string, input: ResenaInput): Promise<ResenaDto> {
    return this.call('createReview', { id, ...input });
  }

  createAnonymous(id: string, autorNombre: string, input: ResenaInput): Promise<ResenaDto> {
    return this.call('createAnonymousReview', { id, autor_nombre: autorNombre, ...input });
  }

  listMine(paging: { page?: number; limit?: number } = {}): Promise<ResenaPage> {
    return this.call('listMyReviews', paging);
  }

  updateMine(id: number, input: ResenaInput): Promise<ResenaDto> {
    return this.call('updateMyReview', { id, ...input });
  }

  adminList(filters: { visible?: boolean; atr_id?: number; page?: number; limit?: number } = {}): Promise<ResenaPage> {
    return this.call('adminListReviews', filters);
  }

  setVisible(id: number, visible: boolean): Promise<ResenaDto> {
    return this.call('setReviewVisible', { id, visible });
  }
}
