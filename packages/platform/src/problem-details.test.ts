import { runWithContext } from './correlation';
import { AppError, fromProblem, problemType, statusTitle, toProblem } from './problem-details';

describe('problem-details · ProblemDetails del contrato v3', () => {
  afterEach(() => jest.restoreAllMocks());

  it('T2 · AppError → toProblem trae type, title, status, code, correlation_id y timestamp', () => {
    const problem = runWithContext({ correlationId: 'cid-prueba-1' }, () => toProblem(AppError.notFound('No existe la atracción.'), '/api/v3/atracciones/X'));
    expect(problem).toEqual({
      type: 'https://booking.epn.edu.ec/errors/not-found',
      title: 'Recurso no encontrado',
      status: 404,
      detail: 'No existe la atracción.',
      instance: '/api/v3/atracciones/X',
      code: 'NOT_FOUND',
      correlation_id: 'cid-prueba-1',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    });
  });

  it('T2 · error desconocido → 500 INTERNAL_ERROR sin filtrar el mensaje interno', () => {
    const problem = toProblem(new TypeError('conexión a postgres://usuario:clave@host rechazada'));
    expect(problem.status).toBe(500);
    expect(problem.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(problem)).not.toContain('postgres://');
  });

  it('T2 · conserva invalid_params de un error de validación', () => {
    const problem = toProblem(AppError.validation('Datos inválidos.', [{ name: 'customer.phone', reason: 'Formato.' }]));
    expect(problem).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', invalid_params: [{ name: 'customer.phone', reason: 'Formato.' }] });
  });

  it('T2 · sin contexto de petición no inventa correlation_id', () => {
    expect(toProblem(AppError.unauthorized())).not.toHaveProperty('correlation_id');
  });

  it('T2 · títulos propios del contrato por código y por estado', () => {
    expect(new AppError(409, 'CANCELLATION_DEADLINE_PASSED', 'x').title).toBe('Cancelación Fuera de Plazo');
    expect(AppError.unavailable().title).toBe('Servicio no disponible');
    expect(statusTitle(422)).toBe('Entidad no procesable');
    expect(statusTitle(418)).toBe('Error');
    expect(problemType('OUT_OF_STOCK')).toBe('https://booking.epn.edu.ec/errors/sin-cupos');
  });

  it('T2 · fromProblem reconstruye un cuerpo que no es ProblemDetails con el estado HTTP recibido', () => {
    expect(fromProblem('texto plano', 502)).toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
    expect(fromProblem(undefined, 404)).toMatchObject({ status: 404, code: 'ERROR', message: 'Error en un servicio interno.' });
  });
});
