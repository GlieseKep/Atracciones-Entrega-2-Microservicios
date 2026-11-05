/** Ciudades de ms-location (`locationListCities`). */
export interface City {
  id: number;
  codigo: string;
  nombre: string;
  activa: boolean;
  descripcion: string | null;
  imagen: string | null;
  provincia: { id: number; nombre: string };
  region: { codigo: string; nombre: string };
}
