import { describe, expect, it } from 'vitest';
import { DEMO_ATTRACTIONS } from './demoCatalog';
import { applyFilters, DEFAULT_FILTERS, parseFilters, serializeFilters } from './filters';
import { demoAvailability } from './catalogService';
import { addDays, today } from '@/utils/dates';

const f = (patch = {}) => ({ ...DEFAULT_FILTERS, ...patch });

describe('filtros y búsqueda', () => {
  it('serializa y vuelve a leer los filtros desde la URL', () => {
    const filters = f({ city: 'Quito', categories: ['Cultura', 'Aventura'], maxPrice: 50, durations: ['1-4h'], freeCancellation: true, sort: 'precio-asc', page: 2 });
    expect(parseFilters(serializeFilters(filters))).toEqual(filters);
  });

  it('ignora valores inválidos de la URL', () => {
    const parsed = parseFilters(new URLSearchParams('fecha=31-12-2026&precioMax=-4&orden=hack&duracion=x,1-4h&pagina=0'));
    expect(parsed.date).toBe('');
    expect(parsed.maxPrice).toBeNull();
    expect(parsed.sort).toBe('destacados');
    expect(parsed.durations).toEqual(['1-4h']);
    expect(parsed.page).toBe(1);
  });

  it('filtra por región (ciudad)', () => {
    const { items } = applyFilters(DEMO_ATTRACTIONS, f({ city: 'Latacunga' }), 50);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((a) => a.locations.some((l) => l.city === 'Latacunga'))).toBe(true);
  });

  it('busca texto sin distinguir acentos ni mayúsculas', () => {
    const { items } = applyFilters(DEMO_ATTRACTIONS, f({ q: 'teleferiqo' }), 50);
    expect(items.map((a) => a.id)).toContain('a1b2c3d4-0001-4000-8000-000000000001');
  });

  it('combina categoría, precio, duración y cancelación', () => {
    const { items } = applyFilters(DEMO_ATTRACTIONS, f({ categories: ['Naturaleza'], maxPrice: 80, durations: ['4h-1d'], freeCancellation: true }), 50);
    expect(items.length).toBeGreaterThan(0);
    for (const a of items) {
      expect(a.categories).toContain('Naturaleza');
      expect(a.price.total).toBeLessThanOrEqual(80);
      expect(a.freeCancellation).toBe(true);
    }
  });

  it('ordena por precio y pagina', () => {
    const page1 = applyFilters(DEMO_ATTRACTIONS, f({ sort: 'precio-asc' }), 3);
    const prices = page1.items.map((a) => a.price.total);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(page1.totalPages).toBe(Math.ceil(DEMO_ATTRACTIONS.length / 3));
    expect(applyFilters(DEMO_ATTRACTIONS, f({ page: 99 }), 3).page).toBe(page1.totalPages);
  });

  it('devuelve cero resultados cuando nada coincide', () => {
    expect(applyFilters(DEMO_ATTRACTIONS, f({ q: 'galápagos submarino' })).total).toBe(0);
  });

  it('la disponibilidad de demostración no ofrece fechas pasadas', () => {
    expect(demoAvailability('x', addDays(today(), -1)).times).toHaveLength(0);
    expect(demoAvailability('x', today()).times.map((t) => t.time)).toEqual(['09:00', '14:00']);
  });
});
