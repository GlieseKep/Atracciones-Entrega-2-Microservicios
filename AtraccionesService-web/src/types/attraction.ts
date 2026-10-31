import type { IsoDate, Price } from './api';

/** Tipos del catálogo (AtraccionesService.Contracts/Catalog). */

export type ProductType = 'SINGLE_TICKET' | 'GUIDED_TOUR' | 'PACKAGE';
export type SlotStatus = 'AVAILABLE' | 'SOLD_OUT';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Location {
  address: string;
  city: string;
  country: string;
  coordinates?: Coordinates | null;
  type?: string | null;
}

export interface Photo {
  url: string;
}

export interface Operator {
  id: number;
  name: string;
}

export interface Rating {
  numberOfReviews: number;
  score: number;
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
  photos: Photo[];
  operator?: Operator | null;
  productType: ProductType;
  includes: string[];
  supportedLanguages: string[];
  freeCancellation: boolean;
  ratings?: Rating | null;
  url?: { web?: string | null; app?: string | null } | null;
  _links?: Record<string, string>;
}

export interface CreateAttractionRequest {
  name: string;
  longDescription: string;
  duration: string;
  price: Price;
  categories: string[];
  badges: string[];
  locations: Location[];
  photos: Photo[];
  operator?: Operator | null;
  productType: ProductType;
  includes: string[];
  supportedLanguages: string[];
  freeCancellation: boolean;
}

export type UpdateAttractionRequest = Partial<CreateAttractionRequest>;

export interface PaginatedAttractionResponse {
  data: Attraction[];
  meta: {
    totalItems: number;
    itemCount: number;
    itemsPerPage: number;
    totalPages: number;
    currentPage: number;
  };
}

export type SearchSortBy = 'most_popular' | 'price_asc' | 'price_desc' | 'rating_desc';

export interface SearchAttractionsRequest {
  currency?: string;
  cities?: string[];
  countries?: string[];
  dates?: { startDate?: IsoDate; endDate?: IsoDate };
  filters?: { rating?: { minimumReviewScore?: number; minimumReviewCount?: number } };
  nextPage?: string;
  rows?: number;
  sort?: { by: SearchSortBy };
}

export interface SearchAttractionsResponse {
  data: Attraction[];
  metadata: { totalResults: number; nextPage?: string | null };
  requestId: string;
}

export interface AvailabilitySlot {
  /** Hora local `HH:mm`. */
  time: string;
  availableSpots: number;
  status: SlotStatus;
}

export interface Availability {
  date: IsoDate;
  timeZone: string;
  availableSpots: number;
  times: AvailabilitySlot[];
}
