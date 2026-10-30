import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsIsoDate, PATTERNS, PriceDto } from './common';

export const PRODUCT_TYPES = ['SINGLE_TICKET', 'GUIDED_TOUR', 'PACKAGE'] as const;
export const SORT_BY = ['most_popular', 'price_asc', 'price_desc', 'rating_desc'] as const;

/** Coordenadas WGS84 en grados decimales. */
export class CoordinatesDto {
  @ApiProperty({ minimum: -90, maximum: 90 }) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty({ minimum: -180, maximum: 180 }) @IsNumber() @Min(-180) @Max(180) longitude!: number;
}

export class LocationDto {
  @ApiProperty({ maxLength: 300 }) @IsString() @Length(1, 300) address!: string;
  @ApiProperty({ maxLength: 120 }) @IsString() @Length(1, 120) city!: string;

  @ApiProperty({ example: 'EC', description: 'Código ISO 3166-1 alfa-2.' })
  @Matches(PATTERNS.country, { message: 'country debe ser un código ISO 3166-1 alfa-2.' })
  country!: string;

  @ApiPropertyOptional({ type: CoordinatesDto }) @IsOptional() @ValidateNested() @Type(() => CoordinatesDto) coordinates?: CoordinatesDto | null;
  @ApiPropertyOptional({ maxLength: 60 }) @IsOptional() @IsString() @MaxLength(60) type?: string | null;
}

export class PhotoDto {
  @ApiProperty({ example: 'https://example.com/foto.jpg' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  url!: string;
}

export class OperatorDto {
  @ApiProperty() @IsInt() @Min(1) id!: number;
  @ApiProperty({ maxLength: 200 }) @IsString() @Length(1, 200) name!: string;
}

/** Cuerpo de `POST /atracciones` y `PUT /atracciones/{id}`. En PUT reemplaza el recurso completo. */
export class CreateAttractionRequest {
  @ApiProperty({ minLength: 3, maxLength: 200 }) @IsString() @Length(3, 200) name!: string;
  @ApiProperty({ maxLength: 5000 }) @IsString() @Length(1, 5000) longDescription!: string;

  @ApiProperty({ example: 'PT3H', description: 'Duración ISO 8601.' })
  @Matches(PATTERNS.isoDuration, { message: 'duration debe ser una duración ISO 8601, por ejemplo PT3H.' })
  duration!: string;

  @ApiProperty({ type: PriceDto }) @ValidateNested() @Type(() => PriceDto) price!: PriceDto;

  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @IsString({ each: true }) categories!: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) badges: string[] = [];

  @ApiProperty({ type: [LocationDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LocationDto) locations!: LocationDto[];
  @ApiPropertyOptional({ type: [PhotoDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PhotoDto) photos: PhotoDto[] = [];

  @ApiPropertyOptional({ type: OperatorDto }) @IsOptional() @ValidateNested() @Type(() => OperatorDto) operator?: OperatorDto | null;

  @ApiProperty({ enum: PRODUCT_TYPES }) @IsIn(PRODUCT_TYPES) productType!: (typeof PRODUCT_TYPES)[number];

  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) includes: string[] = [];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) supportedLanguages: string[] = [];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() freeCancellation = false;
}

/**
 * Cuerpo de `PATCH /atracciones/{id}`: cambios parciales. Una propiedad omitida o `null` no se modifica.
 * Las propiedades de solo lectura (`id`, `ratings`, `url`, `_links`) se rechazan.
 * Se declara explícitamente (sin `PartialType`) para no heredar valores por defecto que sobrescribirían datos.
 */
export class UpdateAttractionRequest {
  @ApiPropertyOptional({ minLength: 3, maxLength: 200 }) @IsOptional() @IsString() @Length(3, 200) name?: string | null;
  @ApiPropertyOptional({ maxLength: 5000 }) @IsOptional() @IsString() @Length(1, 5000) longDescription?: string | null;

  @ApiPropertyOptional({ example: 'PT3H' })
  @IsOptional()
  @Matches(PATTERNS.isoDuration, { message: 'duration debe ser una duración ISO 8601, por ejemplo PT3H.' })
  duration?: string | null;

  @ApiPropertyOptional({ type: PriceDto }) @IsOptional() @ValidateNested() @Type(() => PriceDto) price?: PriceDto | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMinSize(1) @IsString({ each: true }) categories?: string[] | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) badges?: string[] | null;

  @ApiPropertyOptional({ type: [LocationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LocationDto)
  locations?: LocationDto[] | null;

  @ApiPropertyOptional({ type: [PhotoDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PhotoDto) photos?: PhotoDto[] | null;
  @ApiPropertyOptional({ type: OperatorDto }) @IsOptional() @ValidateNested() @Type(() => OperatorDto) operator?: OperatorDto | null;
  @ApiPropertyOptional({ enum: PRODUCT_TYPES }) @IsOptional() @IsIn(PRODUCT_TYPES) productType?: (typeof PRODUCT_TYPES)[number] | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) includes?: string[] | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) supportedLanguages?: string[] | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() freeCancellation?: boolean | null;
}

export class RatingDto {
  @ApiProperty() numberOfReviews!: number;
  @ApiProperty() score!: number;
}

export class AttractionResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() longDescription!: string;
  @ApiProperty({ example: 'PT2H' }) duration!: string;
  @ApiProperty({ type: PriceDto }) price!: PriceDto;
  @ApiProperty({ type: [String] }) categories!: string[];
  @ApiProperty({ type: [String] }) badges!: string[];
  @ApiProperty({ type: [LocationDto] }) locations!: LocationDto[];
  @ApiProperty({ type: [PhotoDto] }) photos!: PhotoDto[];
  @ApiPropertyOptional({ type: OperatorDto, nullable: true }) operator!: OperatorDto | null;
  @ApiProperty({ enum: PRODUCT_TYPES }) productType!: string;
  @ApiProperty({ type: [String] }) includes!: string[];
  @ApiProperty({ type: [String] }) supportedLanguages!: string[];
  @ApiProperty() freeCancellation!: boolean;
  @ApiPropertyOptional({ type: RatingDto, nullable: true }) ratings!: RatingDto | null;
  @ApiPropertyOptional({ nullable: true }) url!: { web: string | null; app: string | null } | null;
  @ApiProperty({ example: { self: '/internal/web/v1/atracciones/{id}', availability: '/internal/web/v1/atracciones/{id}/availability' } })
  _links!: Record<string, string>;
}

export class PaginationMeta {
  @ApiProperty() totalItems!: number;
  @ApiProperty() itemCount!: number;
  @ApiProperty() itemsPerPage!: number;
  @ApiProperty() totalPages!: number;
  @ApiProperty() currentPage!: number;
}

export class PaginatedAttractionResponse {
  @ApiProperty({ type: [AttractionResponse] }) data!: AttractionResponse[];
  @ApiProperty({ type: PaginationMeta }) meta!: PaginationMeta;
}

/** Parámetros de `GET /atracciones`. */
export class ListAttractionsQuery {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @ApiPropertyOptional({ default: 0, minimum: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

export class SearchDateRange {
  @ApiPropertyOptional({ example: '2026-12-01' }) @IsOptional() @IsIsoDate() startDate?: string;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @IsIsoDate() endDate?: string;
}

export class RatingFilter {
  @ApiPropertyOptional({ minimum: 0, maximum: 5 }) @IsOptional() @IsNumber() @Min(0) @Max(5) minimumReviewScore?: number;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) minimumReviewCount?: number;
}

export class SearchFilters {
  @ApiPropertyOptional({ type: RatingFilter }) @IsOptional() @ValidateNested() @Type(() => RatingFilter) rating?: RatingFilter;
}

export class SearchSort {
  @ApiProperty({ enum: SORT_BY, default: 'most_popular' })
  @IsIn(SORT_BY, { message: 'sort.by no es un criterio de orden permitido.' })
  by: (typeof SORT_BY)[number] = 'most_popular';
}

/** Cuerpo de `POST /atracciones/search`. */
export class SearchAttractionsRequest {
  @ApiPropertyOptional({ example: 'USD' }) @IsOptional() @Matches(PATTERNS.currency, { message: 'currency debe ser un código ISO 4217.' }) currency?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 20 }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) cities: string[] = [];

  @ApiPropertyOptional({ type: [String], maxItems: 20, description: 'Códigos ISO 3166-1 alfa-2.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(PATTERNS.country, { each: true, message: 'Los países deben ser códigos ISO 3166-1 alfa-2.' })
  countries: string[] = [];

  @ApiPropertyOptional({ type: SearchDateRange }) @IsOptional() @ValidateNested() @Type(() => SearchDateRange) dates?: SearchDateRange;
  @ApiPropertyOptional({ type: SearchFilters }) @IsOptional() @ValidateNested() @Type(() => SearchFilters) filters?: SearchFilters;

  @ApiPropertyOptional({ description: 'Token opaco emitido por una respuesta previa.' }) @IsOptional() @IsString() @MaxLength(512) nextPage?: string;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 }) @IsOptional() @IsInt() @Min(1) @Max(100) rows = 20;
  @ApiPropertyOptional({ type: SearchSort }) @IsOptional() @ValidateNested() @Type(() => SearchSort) sort?: SearchSort;
}

export class SearchMetadata {
  @ApiProperty() totalResults!: number;
  @ApiPropertyOptional({ nullable: true }) nextPage!: string | null;
}

export class SearchAttractionsResponse {
  @ApiProperty({ type: [AttractionResponse] }) data!: AttractionResponse[];
  @ApiProperty({ type: SearchMetadata }) metadata!: SearchMetadata;
  @ApiProperty() requestId!: string;
}

/** Cuerpo de `POST /atracciones/details`. */
export class DetailsRequest {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  attractions!: string[];

  @ApiPropertyOptional({ type: [String], maxItems: 10 }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) languages: string[] = [];
}

export class AvailabilityQuery {
  @ApiProperty({ example: '2026-12-01', description: 'Fecha local de la atracción.' }) @IsIsoDate() date!: string;
}

export class AvailabilitySlotDto {
  @ApiProperty({ example: '09:00' }) time!: string;
  @ApiProperty() availableSpots!: number;
  @ApiProperty({ enum: ['AVAILABLE', 'SOLD_OUT'] }) status!: 'AVAILABLE' | 'SOLD_OUT';
}

/** Respuesta de `GET /atracciones/{id}/availability`. `timeZone` es un identificador IANA. */
export class AvailabilityResponse {
  @ApiProperty({ example: '2026-12-01' }) date!: string;
  @ApiProperty({ example: 'America/Guayaquil' }) timeZone!: string;
  @ApiProperty({ description: 'Suma de cupos disponibles de todas las franjas de la fecha.' }) availableSpots!: number;
  @ApiProperty({ type: [AvailabilitySlotDto] }) times!: AvailabilitySlotDto[];
}
