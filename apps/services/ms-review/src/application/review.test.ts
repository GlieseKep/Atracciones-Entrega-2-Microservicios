import { AppError, createLogger, type EsbClient } from '@atracciones/platform';
import type { ReviewRepository, ReviewRow } from '../persistence/review-repository';
import { parseReview } from './review-input';
import { ReviewService } from './review-service';

process.env.LOG_SILENT = 'true';
const logger = createLogger('pruebas');

const row = (usuId: string | null, autor: string | null = null): ReviewRow => ({ ren_id: '1', atr_id: '7', usu_id: usuId, ren_autor_nombre: autor, ren_puntuacion: 9, ren_limpieza: 9, ren_servicio: 9, ren_calidad_precio: 8, ren_puntualidad: 10, ren_comentario: 'Muy bueno', ren_visible: true, ren_creado_en: new Date('2026-11-20T12:00:00Z') });
const input = { puntuacion: 9, limpieza: 9, servicio: 9, calidad_precio: 8, puntualidad: 10, comentario: 'Muy bueno' };

function setup(identity: () => unknown = () => [{ id: 3, nombre: 'Ana', apellido: 'Pérez' }]) {
  const call = jest.fn(async (_s: string, op: string) => (op === 'getReference' ? { atr_id: 7 } : identity()));
  const repo = { createForUser: jest.fn(async () => row('3')), createAnonymous: jest.fn(async () => row(null, 'Turista')) } as unknown as ReviewRepository & { createForUser: jest.Mock };
  return { service: new ReviewService(repo, { call } as unknown as EsbClient, logger), repo, call };
}

afterEach(() => jest.restoreAllMocks());

describe('ms-review/review-service · reseñas (RESENA_PUBLICADA se prueba en integración)', () => {
  it('publicar resuelve la atracción en Catalog y muestra el autor como "Nombre A."', async () => {
    const { service, repo } = setup();
    await expect(service.createForUser('PRhu4UBTWPBC', 3, input)).resolves.toMatchObject({ atr_id: 7, autor_nombre: 'Ana P.', anonima: false, puntuacion: 9 });
    expect(repo.createForUser).toHaveBeenCalledWith(7, 3, input);
  });
  it('Identity caído → autor "Viajero"; reseña anónima conserva su nombre', async () => {
    await expect(setup(() => { throw AppError.unavailable(); }).service.createForUser('A', 3, input)).resolves.toMatchObject({ autor_nombre: 'Viajero' });
    await expect(setup().service.createAnonymous('A', 'Turista', input)).resolves.toMatchObject({ autor_nombre: 'Turista', anonima: true });
  });
  it('calificación fuera de 1–10 → 400', () => {
    expect(() => parseReview({ ...input, limpieza: 11 })).toThrow(expect.objectContaining({ invalidParams: [expect.objectContaining({ name: 'limpieza' })] }));
  });
  it('comentario vacío → 400; la atracción se guarda en caché 5 min', async () => {
    expect(() => parseReview({ ...input, comentario: ' ' })).toThrow(expect.objectContaining({ status: 400 }));
    const { service, call } = setup();
    await service.attractionId('A');
    await service.attractionId('A');
    expect(call.mock.calls.filter((c) => c[1] === 'getReference')).toHaveLength(1);
  });
});
