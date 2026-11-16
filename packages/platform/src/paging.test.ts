import { optionalText, paging } from './paging';

describe('paging · paginación de listados', () => {
  it('valores por defecto', () => {
    expect(paging({})).toEqual({ limit: 20, offset: 0 });
  });

  it('respeta el máximo de página', () => {
    expect(paging({ limit: 1000 })).toEqual({ limit: 200, offset: 0 });
    expect(paging({ limit: '50' }, 10, 30)).toEqual({ limit: 30, offset: 0 });
  });

  it('limit u offset negativos o cero toman el defecto', () => {
    expect(paging({ limit: 0, offset: -5 })).toEqual({ limit: 20, offset: 0 });
  });

  it('valores no numéricos o decimales toman el defecto', () => {
    expect(paging({ limit: 'abc', offset: '2.5' })).toEqual({ limit: 20, offset: 0 });
  });

  it('acepta texto numérico y optionalText recorta o devuelve null', () => {
    expect(paging({ limit: '15', offset: '30' })).toEqual({ limit: 15, offset: 30 });
    expect(optionalText('  Quito ')).toBe('Quito');
    expect(optionalText('   ')).toBeNull();
    expect(optionalText(5)).toBeNull();
  });
});
