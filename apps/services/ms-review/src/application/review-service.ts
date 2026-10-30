import { errorFields, type EsbClient, type Logger } from '@atracciones/platform';
import type { ResenaDto, ResenaInput, ResenaPage } from '../contract';
import type { ReviewFilters, ReviewRepository, ReviewRow } from '../persistence/review-repository';

const CACHE_TTL_MS = 5 * 60_000;
const FALLBACK_AUTHOR = 'Viajero';

interface UsuarioResumen {
  id: number;
  nombre: string;
  apellido: string;
}

export class ReviewService {
  private readonly attractions = new Map<string, { atrId: number; loadedAt: number }>();

  constructor(
    private readonly reviews: ReviewRepository,
    private readonly esb: EsbClient,
    private readonly logger: Logger,
  ) {}

  /** Las rutas reciben el ID público o slug; Catalog responde `404` si no existe o no está publicada. */
  async attractionId(id: string): Promise<number> {
    const cached = this.attractions.get(id);
    if (cached && cached.loadedAt + CACHE_TTL_MS > Date.now()) return cached.atrId;
    const { atr_id: atrId } = await this.esb.call<{ atr_id: number }>('catalog', 'getReference', { id });
    this.attractions.set(id, { atrId, loadedAt: Date.now() });
    return atrId;
  }

  /** `Nombre A.`, sin correo. Si Identity falla, la lista sigue funcionando con `Viajero`. */
  private async authors(rows: ReviewRow[]): Promise<Map<number, string>> {
    const ids = [...new Set(rows.filter((row) => row.usu_id !== null).map((row) => Number(row.usu_id)))];
    const names = new Map<number, string>();
    if (ids.length === 0) return names;
    try {
      const users = await this.esb.call<UsuarioResumen[]>('identity', 'getUsers', { ids });
      for (const user of users) names.set(user.id, `${user.nombre} ${user.apellido.charAt(0)}.`);
    } catch (error) {
      this.logger.warn('Identity no respondió; se usa el nombre genérico', errorFields(error));
    }
    return names;
  }

  private toDto(row: ReviewRow, names: Map<number, string>): ResenaDto {
    return {
      id: Number(row.ren_id),
      atr_id: Number(row.atr_id),
      autor_nombre: row.usu_id === null ? (row.ren_autor_nombre as string) : (names.get(Number(row.usu_id)) ?? FALLBACK_AUTHOR),
      anonima: row.usu_id === null,
      puntuacion: row.ren_puntuacion,
      limpieza: row.ren_limpieza,
      servicio: row.ren_servicio,
      calidad_precio: row.ren_calidad_precio,
      puntualidad: row.ren_puntualidad,
      comentario: row.ren_comentario,
      visible: row.ren_visible,
      creado_en: row.ren_creado_en.toISOString(),
    };
  }

  async present(row: ReviewRow): Promise<ResenaDto> {
    return this.toDto(row, await this.authors([row]));
  }

  async list(filters: ReviewFilters, page: number, limit: number): Promise<ResenaPage> {
    const { total, rows } = await this.reviews.list(filters, page, limit);
    const names = await this.authors(rows);
    return {
      data: rows.map((row) => this.toDto(row, names)),
      pagination: { total_results: total, page, limit, total_pages: Math.ceil(total / limit) },
    };
  }

  async createForUser(id: string, usuId: number, input: ResenaInput): Promise<ResenaDto> {
    return this.present(await this.reviews.createForUser(await this.attractionId(id), usuId, input));
  }

  async createAnonymous(id: string, autorNombre: string, input: ResenaInput): Promise<ResenaDto> {
    return this.present(await this.reviews.createAnonymous(await this.attractionId(id), autorNombre, input));
  }
}
