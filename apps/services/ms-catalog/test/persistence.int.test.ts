import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { parseAttraction } from '../src/application/attraction-input';
import { parseSearchBody } from '../src/application/search';
import { AttractionRepository, type PublicFilters } from '../src/persistence/attraction-repository';
import { CategoryRepository } from '../src/persistence/category-repository';
import { GuideRepository } from '../src/persistence/guide-repository';
import { InclusionRepository } from '../src/persistence/inclusion-repository';
import { OperatorRepository } from '../src/persistence/operator-repository';

const filters = (overrides: Partial<PublicFilters> = {}): PublicFilters => ({
  query: null, queryCityIds: [], cityIds: null, categoria: null, incluyeComida: false, incluyeTransporte: false, incluyeGuia: false, precioMin: null, precioMax: null,
  duracionMax: null, idioma: null, accesibleSillaRuedas: false, animalesAsistencia: false, cancelacionGratuita: false, codigos: null, ...overrides,
});

describe('ms-catalog · persistencia en ms_catalog (P1–P5)', () => {
  let db: MsDatabase;
  let attractions: AttractionRepository;
  let categories: CategoryRepository;
  let opeId: number;
  let incId: number;

  const add = async (codigo: string, body: Record<string, unknown>) => {
    const input = parseAttraction({ description: 'Desc', tipo: 'GUIDED_TOUR', latitude: -1.39, longitude: -78.42, duration_hours: 2, ciu_id: 5, operador: 'OPE-1', categorias: ['cat-aventura-100'], ...body });
    const atrId = await db.dataSource.transaction((m) => attractions.insert(codigo, input.slug ?? codigo.toLowerCase(), input, opeId, m));
    await attractions.setState(atrId, 'PUBLICADA');
    return atrId;
  };

  beforeAll(async () => {
    db = await msDatabase('ms-catalog');
    attractions = new AttractionRepository(db.dataSource);
    categories = new CategoryRepository(db.dataSource);
    const operators = new OperatorRepository(db.dataSource);
    await operators.create({ codigo: 'OPE-1', nombre: 'Operador Baños', ruc: null, correo: null, telefono: null, direccion: null, provId: 18 });
    opeId = (await operators.idByCode('OPE-1'))!;
    await new GuideRepository(db.dataSource).create({ opeId, codigo: 'GUIA-CARLOS-01', nombre: 'Carlos', credencial: 'MINTUR-1', usuId: null });
    incId = (await new InclusionRepository(db.dataSource).create('INCLUYE', 'Equipo de seguridad', 1)).id;
    await categories.create({ codigo: 'cat-rafting-200', padre: 'cat-aventura-100', nombre: 'Rafting', slug: 'rafting', descripcion: null, icono: null, orden: 1, incluyeComida: true, incluyeTransporte: true, incluyeGuia: true }, Number((await categories.findByCode('cat-aventura-100'))!.cat_id));
    await add('PRhu4UBTWPBC', { name: 'Rafting en Baños', categorias: ['cat-rafting-200'], inclusions: { includes_food: true, includes_guide: true }, idiomas: ['es', 'en'], inclusiones: [incId] });
    await add('QUITOcultura', { name: 'Centro histórico de Quito', categorias: ['cat-cultural-100'], ciu_id: 1 });
  });
  afterAll(async () => {
    await db.drop();
  });

  it('P1 · árbol de categorías: la subcategoría cuelga de su padre y conserva sus banderas incluye_*', async () => {
    const rows = await categories.listActive();
    const padre = rows.find((r) => r.cat_codigo === 'cat-aventura-100')!;
    const hija = rows.find((r) => r.cat_codigo === 'cat-rafting-200')!;
    expect(hija).toMatchObject({ cat_padre_id: padre.cat_id, padre_codigo: 'cat-aventura-100', cat_incluye_comida: true, cat_incluye_transporte: true, cat_incluye_guia: true });
    expect(rows.filter((r) => r.cat_padre_id === null).length).toBeGreaterThanOrEqual(5);
  });

  it('P3 · búsqueda en SQL: la categoría padre incluye a sus subcategorías; filtros y texto se combinan', async () => {
    const porPadre = await attractions.search(filters({ categoria: 'cat-aventura-100' }), 'POPULARITY', 1, 10);
    expect(porPadre.rows.map((r) => r.atr_codigo.trim())).toEqual(['PRhu4UBTWPBC']);
    const combinado = await attractions.search(filters({ incluyeComida: true, idioma: 'Ingles', query: 'baños', cityIds: [5] }), 'PRICE_ASC', 1, 10);
    expect(combinado.total).toBe(1);
    const ninguno = await attractions.search(filters({ incluyeComida: true, cityIds: [1] }), 'POPULARITY', 1, 10);
    expect(ninguno).toEqual({ total: 0, rows: [] });
    // la búsqueda pública usa los criterios ya validados del contrato
    expect(parseSearchBody({ categoria_id: 'cat-aventura-100' }).categoria).toBe('cat-aventura-100');
  });

  it('P5 · ficha: inclusiones, idiomas y guía activo del operador para la logística', async () => {
    const row = (await attractions.findByPublicId('PRhu4UBTWPBC'))!;
    const children = await attractions.children([row.atr_id]);
    expect(children.inclusiones.map((i) => i.inc_nombre)).toEqual(['Equipo de seguridad']);
    expect(children.idiomas.map((i) => i.idi_codigo).sort()).toEqual(['en', 'es']);
    await expect(new GuideRepository(db.dataSource).forReservation(opeId, null)).resolves.toMatchObject({ nombre: 'Carlos' });
  });

  it('sql-errors · violación de unicidad se traduce al error de su restricción (slug y código de categoría)', async () => {
    await expect(add('OTROcodigo12', { name: 'Rafting en Baños', slug: 'prhu4ubtwpbc' })).rejects.toMatchObject({ status: 409, code: 'ATTRACTION_SLUG_EXISTS' });
    await expect(categories.create({ codigo: 'cat-rafting-200', padre: null, nombre: 'X', slug: 'x', descripcion: null, icono: null, orden: 9, incluyeComida: false, incluyeTransporte: false, incluyeGuia: false }, null)).rejects.toMatchObject({ status: 409, code: 'CATEGORY_EXISTS' });
  });
});
