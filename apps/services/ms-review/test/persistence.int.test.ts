import { msDatabase, type MsDatabase } from '../../../../test/support/db';
import { ReviewRepository } from '../src/persistence/review-repository';

const review = (puntuacion: number) => ({ puntuacion, limpieza: puntuacion, servicio: puntuacion, calidad_precio: puntuacion, puntualidad: puntuacion, comentario: 'Bien' });

describe('ms-review · persistencia en ms_review', () => {
  let db: MsDatabase;
  let reviews: ReviewRepository;
  const events = async () => db.dataSource.query(`SELECT tipo_evento, payload FROM outbox ORDER BY creado_en`) as Promise<{ tipo_evento: string; payload: Record<string, number> }[]>;

  beforeAll(async () => {
    db = await msDatabase('ms-review');
    reviews = new ReviewRepository(db.dataSource);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('reseña de usuario y RESENA_PUBLICADA con el promedio y la cantidad recalculados', async () => {
    await reviews.createForUser(7, 1, review(10));
    await reviews.createForUser(7, 2, review(8));
    const published = await events();
    expect(published.map((e) => e.tipo_evento)).toEqual(['RESENA_PUBLICADA', 'RESENA_PUBLICADA']);
    expect(published[1].payload).toMatchObject({ atr_id: 7, promedio: 9, numero_resenas: 2 });
  });

  it('reseña duplicada del mismo usuario → 409; la anónima queda oculta y no publica promedios', async () => {
    await expect(reviews.createForUser(7, 1, review(5))).rejects.toMatchObject({ status: 409, code: 'REVIEW_ALREADY_EXISTS' });
    await reviews.createAnonymous(7, 'Turista', review(1));
    expect(await events()).toHaveLength(2);
  });
});
