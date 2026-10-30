/** Tipos del contrato `Plan/ms_location/ms_location-openapi.yaml`. */
export interface ProvinciaDto {
  id: number;
  codigo: string;
  nombre: string;
  region_codigo: string;
  activa: boolean;
}

export interface CiudadDto {
  id: number;
  codigo: string;
  nombre: string;
  activa: boolean;
  descripcion: string | null;
  imagen: string | null;
  provincia: { id: number; nombre: string };
  region: { codigo: string; nombre: string };
}

export interface RegionArbolDto {
  id: number;
  codigo: string;
  nombre: string;
  provincias: {
    id: number;
    codigo: string;
    nombre: string;
    ciudades: { id: number; codigo: string; nombre: string }[];
  }[];
}

export interface ResolucionDto {
  resueltas: { nombre_enviado: string; ciudades: CiudadDto[] }[];
  no_encontrados: string[];
}
