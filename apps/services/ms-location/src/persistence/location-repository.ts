import type { DataSource } from 'typeorm';

export interface RegionRow {
  reg_id: number;
  reg_nombre: string;
  reg_codigo: string;
}

export interface ProvinciaRow {
  prov_id: number;
  prov_nombre: string;
  prov_codigo: string;
  reg_id: number;
  prov_activa: boolean;
}

export interface CiudadRow {
  ciu_id: number;
  ciu_nombre: string;
  ciu_codigo: string;
  prov_id: number;
  ciu_activa: boolean;
  ciu_descripcion: string | null;
  ciu_imagen: string | null;
}

export interface GeographyRows {
  regions: RegionRow[];
  provinces: ProvinciaRow[];
  cities: CiudadRow[];
}

export class LocationRepository {
  constructor(private readonly db: DataSource) {}

  async load(): Promise<GeographyRows> {
    return {
      regions: await this.db.query(`SELECT reg_id, reg_nombre, reg_codigo FROM region ORDER BY reg_id`),
      provinces: await this.db.query(`SELECT prov_id, prov_nombre, prov_codigo, reg_id, prov_activa FROM provincia ORDER BY prov_nombre`),
      cities: await this.db.query(
        `SELECT ciu_id, ciu_nombre, ciu_codigo, prov_id, ciu_activa, ciu_descripcion, ciu_imagen FROM ciudad ORDER BY ciu_nombre`,
      ),
    };
  }
}
