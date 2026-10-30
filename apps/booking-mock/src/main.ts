import { createLogger } from '@atracciones/platform';
import { startBookingMock, startInspectionServer } from './index';

/** `npm run start -w @atracciones/booking-mock`: gRPC en BOOKING_MOCK_PORT (50051) y GET /received en BOOKING_MOCK_HTTP_PORT (4090). */
async function main() {
  const logger = createLogger('booking-mock');
  const mock = await startBookingMock(Number(process.env.BOOKING_MOCK_PORT ?? 50051));
  const http = await startInspectionServer(mock, Number(process.env.BOOKING_MOCK_HTTP_PORT ?? 4090));
  logger.info('Mock de Booking listo', { grpc_port: mock.grpcPort, inspeccion: `${http.url}/received` });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
