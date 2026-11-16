import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { Geography } from '../src/application/geography';
import { LocationRepository } from '../src/persistence/location-repository';

describe('ms-location · persistencia en ms_location (P3)', () => {
  let db: MsDatabase;

  beforeAll(async () => {
    db = await msDatabase('ms-location');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('ciudades por provincia con los datos semilla de la migración; una provincia resuelve a sus ciudades', async () => {
    const geography = new Geography(await new LocationRepository(db.dataSource).load());
    const pichincha = geography.provinces(null).find((p) => p.nombre === 'Pichincha');
    expect(pichincha).toBeDefined();
    const cities = geography.cities({ q: null, provinciaId: pichincha!.id });
    expect(cities.map((c) => c.nombre)).toContain('Quito');
    expect(cities.every((c) => c.provincia.id === pichincha!.id)).toBe(true);
    expect(geography.resolve(['Pichincha']).resueltas[0].ciudades.map((c) => c.id).sort()).toEqual(cities.map((c) => c.id).sort());
  });
});
