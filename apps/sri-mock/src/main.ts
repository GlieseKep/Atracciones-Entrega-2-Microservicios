import { createLogger } from '@atracciones/platform';
import { startSriMock } from './index';

/** `npm run start -w @atracciones/sri-mock`: simulador del SRI en SRI_MOCK_PORT (4091). */
startSriMock(Number(process.env.SRI_MOCK_PORT ?? 4091))
  .then((mock) => createLogger('sri-mock').info('Simulador del SRI listo', { recepcion: mock.recepcionUrl, autorizacion: mock.autorizacionUrl }))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
