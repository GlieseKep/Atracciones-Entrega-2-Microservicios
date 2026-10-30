import { namesFor, normalizeName, resolveNames, type City } from './destinations';

const cities: City[] = [
  { id: 1, name: 'Quito' },
  { id: 2, name: 'Baños' },
  { id: 3, name: 'Cuenca' },
  { id: 9, name: 'Santa Rosa' },
  { id: 7, name: 'Santa Rosa' },
];

describe('destinos', () => {
  it('compara sin tildes, mayúsculas ni espacios de más', () => {
    expect(normalizeName('  Baños ')).toBe('banos');
    expect(normalizeName('GALÁPAGOS')).toBe('galapagos');
    expect(normalizeName('Santa   Rosa')).toBe('santa rosa');
  });

  it('resuelve nombres a ids y lista los que no existen', () => {
    expect(resolveNames(['quito', 'BANOS', 'Quito', 'Atlantis'], cities)).toEqual({ ids: [1, 2], missing: ['Atlantis'] });
  });

  it('con nombres repetidos en dos provincias usa el id menor', () => {
    expect(resolveNames(['Santa Rosa'], cities).ids).toEqual([7]);
  });

  it('devuelve los nombres en orden alfabético y aparta los ids que ya no existen', () => {
    expect(namesFor([3, 1, 2, 99], cities)).toEqual({ names: ['Baños', 'Cuenca', 'Quito'], unknown: [99] });
  });
});
