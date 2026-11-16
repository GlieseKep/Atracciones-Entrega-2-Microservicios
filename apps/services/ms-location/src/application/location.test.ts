import type { GeographyRows } from '../persistence/location-repository';
import { Geography, normalize } from './geography';
import { parseIds, parseNames } from './input';

const ROWS: GeographyRows = {
  regions: [{ reg_id: 1, reg_nombre: 'Sierra', reg_codigo: 'SIERRA' }, { reg_id: 2, reg_nombre: 'Insular', reg_codigo: 'INSULAR' }],
  provinces: [
    { prov_id: 17, prov_nombre: 'Pichincha', prov_codigo: '17', reg_id: 1, prov_activa: true },
    { prov_id: 18, prov_nombre: 'Tungurahua', prov_codigo: '18', reg_id: 1, prov_activa: true },
    { prov_id: 20, prov_nombre: 'Galápagos', prov_codigo: '20', reg_id: 2, prov_activa: true },
  ],
  cities: [
    { ciu_id: 1, ciu_nombre: 'Quito', ciu_codigo: 'UIO', prov_id: 17, ciu_activa: true, ciu_descripcion: null, ciu_imagen: null },
    { ciu_id: 2, ciu_nombre: 'Baños', ciu_codigo: 'BAN', prov_id: 18, ciu_activa: true, ciu_descripcion: null, ciu_imagen: null },
    { ciu_id: 3, ciu_nombre: 'Puerto Ayora', ciu_codigo: 'PAY', prov_id: 20, ciu_activa: true, ciu_descripcion: null, ciu_imagen: null },
    { ciu_id: 4, ciu_nombre: 'Puerto Baquerizo', ciu_codigo: 'PBM', prov_id: 20, ciu_activa: true, ciu_descripcion: null, ciu_imagen: null },
    { ciu_id: 5, ciu_nombre: 'Cerrada', ciu_codigo: 'CER', prov_id: 17, ciu_activa: false, ciu_descripcion: null, ciu_imagen: null },
  ],
};

describe('ms-location/geography · ciudades por provincia (P3)', () => {
  const geo = new Geography(ROWS);

  it('normalize ignora tildes y mayúsculas', () => {
    expect(normalize('  BAÑOS ')).toBe('banos');
  });
  it('resolve: un nombre de ciudad sin tilde resuelve la ciudad', () => {
    expect(geo.resolve(['banos']).resueltas[0].ciudades.map((c) => c.id)).toEqual([2]);
  });
  it('resolve: una provincia devuelve todas sus ciudades (Galápagos); un desconocido va a no_encontrados', () => {
    const r = geo.resolve(['Galapagos', 'Atlantis']);
    expect(r.resueltas[0].ciudades.map((c) => c.id)).toEqual([3, 4]);
    expect(r.no_encontrados).toEqual(['Atlantis']);
  });
  it('ciudades por provincia, sin las inactivas; por id incluye inactivas (datos históricos)', () => {
    expect(geo.cities({ q: null, provinciaId: 17 }).map((c) => c.nombre)).toEqual(['Quito']);
    expect(geo.city(5)?.activa).toBe(false);
    expect(geo.citiesByIds([1, 99]).map((c) => c.provincia.nombre)).toEqual(['Pichincha']);
  });
});

describe('ms-location/input', () => {
  it('ids: entre 1 y 200, sin repetidos', () => {
    expect(parseIds({ ids: [1, 1, 2] })).toEqual([1, 2]);
    expect(() => parseIds({ ids: [] })).toThrow(expect.objectContaining({ status: 400 }));
  });
  it('nombres: texto no vacío de hasta 80 caracteres', () => {
    expect(parseNames({ nombres: ['Quito'] })).toEqual(['Quito']);
    expect(() => parseNames({ nombres: [''] })).toThrow(expect.objectContaining({ status: 400 }));
  });
});
