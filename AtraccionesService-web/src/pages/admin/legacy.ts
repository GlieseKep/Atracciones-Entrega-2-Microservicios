import { z } from 'zod';
import { http } from '@/api/client';

/**
 * Tipos y llamadas del catálogo del monolito anterior que solo usa el panel administrativo. El panel queda fuera de
 * `Plan/AUDITORIA_FRONTEND.md` y tiene su propia auditoría pendiente: el portal público no importa nada de aquí.
 */

export interface Price {
  currency: string;
  total: number;
}

export type ProductType = 'SINGLE_TICKET' | 'GUIDED_TOUR' | 'PACKAGE';

export interface Location {
  address: string;
  city: string;
  country: string;
  coordinates?: { latitude: number; longitude: number } | null;
  type?: string | null;
}

export interface Attraction {
  id: string;
  name: string;
  longDescription: string;
  /** Duración ISO 8601, por ejemplo `PT2H`. */
  duration: string;
  price: Price;
  categories: string[];
  badges: string[];
  locations: Location[];
  photos: { url: string }[];
  operator?: { id: number; name: string } | null;
  productType: ProductType;
  includes: string[];
  supportedLanguages: string[];
  freeCancellation: boolean;
}

export type CreateAttractionRequest = Omit<Attraction, 'id'>;

export interface PaginatedAttractionResponse {
  data: Attraction[];
  meta: { totalItems: number; itemCount: number; itemsPerPage: number; totalPages: number; currentPage: number };
}

export const listAttractions = (limit = 10, offset = 0, signal?: AbortSignal) =>
  http.get<PaginatedAttractionResponse>('/atracciones', { query: { limit, offset }, signal });

export const catalogAdmin = {
  create: (body: CreateAttractionRequest, idempotencyKey: string) => http.post<Attraction>('/atracciones', body, { idempotencyKey }),
  replace: (id: string, body: CreateAttractionRequest, idempotencyKey: string) =>
    http.put<void>(`/atracciones/${id}`, body, { idempotencyKey }),
  remove: (id: string, idempotencyKey: string) => http.delete<void>(`/atracciones/${id}`, { idempotencyKey }),
};

export const PRODUCT_TYPE_LABEL = {
  SINGLE_TICKET: 'Entrada',
  GUIDED_TOUR: 'Tour guiado',
  PACKAGE: 'Excursión de día completo',
} as const;

/** `PT2H30M` → `2 h 30 min`; `P1D` → `1 día`. */
export function formatDuration(iso: string): string {
  const match = /^P(?!$)(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso);
  if (!match) return iso;
  const [, d = '0', h = '0', m = '0'] = match;
  const parts = [Number(d) && `${d} ${d === '1' ? 'día' : 'días'}`, Number(h) && `${h} h`, Number(m) && `${m} min`].filter(Boolean);
  return parts.join(' ') || '0 min';
}

export const formatPrice = (price: Price) =>
  new Intl.NumberFormat('es-EC', { style: 'currency', currency: price.currency }).format(price.total);

const isoDurationRegex = /^P(?!$)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?)?$/;

export const attractionFormSchema = z.object({
  name: z.string().trim().min(3, 'Mínimo 3 caracteres.').max(200),
  longDescription: z.string().trim().min(1, 'Describe la atracción.').max(5000),
  duration: z.string().trim().regex(isoDurationRegex, 'Usa una duración ISO 8601, por ejemplo PT3H.'),
  priceTotal: z.coerce.number().positive('Debe ser mayor que cero.').multipleOf(0.01, 'Máximo dos decimales.'),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Código ISO 4217, por ejemplo USD.'),
  productType: z.enum(['SINGLE_TICKET', 'GUIDED_TOUR', 'PACKAGE']),
  categories: z.string().trim().min(1, 'Indica al menos una categoría.'),
  badges: z.string().optional(),
  includes: z.string().optional(),
  supportedLanguages: z.string().optional(),
  photos: z.string().optional(),
  address: z.string().trim().min(1, 'Indica la dirección.').max(300),
  city: z.string().trim().min(1, 'Indica la ciudad.').max(120),
  country: z.string().trim().regex(/^[A-Z]{2}$/, 'Código ISO 3166-1, por ejemplo EC.'),
  freeCancellation: z.boolean(),
});
export type AttractionFormValues = z.infer<typeof attractionFormSchema>;

/** "a, b , c" → ["a","b","c"] */
export const splitList = (value?: string) =>
  (value ?? '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
