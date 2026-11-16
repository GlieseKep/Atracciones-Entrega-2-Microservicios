import { addDays, todayIn } from '@atracciones/platform';
import { parseAttraction } from '../../../apps/services/ms-catalog/src/application/attraction-input';
import { AttractionRepository } from '../../../apps/services/ms-catalog/src/persistence/attraction-repository';
import { CategoryRepository } from '../../../apps/services/ms-catalog/src/persistence/category-repository';
import { GuideRepository } from '../../../apps/services/ms-catalog/src/persistence/guide-repository';
import { OperatorRepository } from '../../../apps/services/ms-catalog/src/persistence/operator-repository';
import { sha256, signAccessToken } from '../../../apps/services/ms-identity/src/application/tokens';
import { SessionRepository } from '../../../apps/services/ms-identity/src/persistence/session-repository';
import { UserRepository } from '../../../apps/services/ms-identity/src/persistence/user-repository';
import { ApiClientRepository } from '../../../apps/services/ms-identity/src/persistence/api-client-repository';
import { ScheduleRepository } from '../../../apps/services/ms-inventory/src/persistence/schedule-repository';
import { PricingRepository } from '../../../apps/services/ms-pricing/src/persistence/pricing-repository';
import { SECRETS, type Stack } from '../../support/stack';

/**
 * Datos comunes de integración y E2E (plan §2): una categoría padre e hija con las tres banderas `incluye_*`, dos
 * atracciones con tarifas por edad, un turno con aforo holgado, uno con 1 cupo (`ULTIMOS_CUPOS`) y uno lleno (`AGOTADO`),
 * un socio con `X-API-Key` activa y otro inactivo, y un turista con cédula válida.
 */
export const ATTRACTION = 'PRhu4UBTWPBC';
export const OTHER_ATTRACTION = 'QUITOcultura';
export const API_KEY = 'clave-socio-booking-de-pruebas';
export const INACTIVE_API_KEY = 'clave-socio-inactivo-de-pruebas';
export const CUSTOMER = { full_name: 'Ana Pérez', email: 'ana@correo.com', phone: '0991234567', document_type: 'CEDULA', document_id: '1710034065' };
export const PRICES = { adult: 45, child: 22.5, senior: 31.5, infant: 0 };

export interface SeedV3 {
  /** Fecha de los turnos: hoy (Ecuador) + 3 días, lejos de medianoche y del límite de 24 h. */
  date: string;
  slots: { holgado: string; ultimo: string; lleno: string };
  times: { holgado: string; ultimo: string; lleno: string };
  partnerId: number;
  /** JWT de acceso de un usuario activo con sesión vigente (T1 con Bearer). */
  userJwt: string;
}

const slotOf = (date: string, time: string) => `slot-${date.replace(/-/g, '')}-${time.slice(0, 5).replace(':', '')}`;

export async function seedV3(stack: Stack): Promise<SeedV3> {
  const today = todayIn();
  const date = addDays(today, 3);
  const result: SeedV3 = {
    date,
    slots: { holgado: slotOf(date, '10:30'), ultimo: slotOf(date, '15:00'), lleno: slotOf(date, '17:00') },
    times: { holgado: '10:30:00', ultimo: '15:00:00', lleno: '17:00:00' },
    partnerId: 0,
    userJwt: '',
  };

  const catalogDb = stack.db['ms-catalog']?.dataSource;
  if (catalogDb) {
    const operators = new OperatorRepository(catalogDb);
    await operators.create({ codigo: 'OPE-BANOS', nombre: 'Operador Baños', ruc: null, correo: null, telefono: null, direccion: null, provId: 18 });
    const opeId = (await operators.idByCode('OPE-BANOS'))!;
    await new GuideRepository(catalogDb).create({ opeId, codigo: 'GUIA-CARLOS-01', nombre: 'Lic. Carlos Morales', credencial: 'MINTUR-0001', usuId: null });
    const categories = new CategoryRepository(catalogDb);
    const padre = (await categories.findByCode('cat-aventura-100'))!;
    await categories.create({ codigo: 'cat-rafting-200', padre: 'cat-aventura-100', nombre: 'Rafting', slug: 'rafting', descripcion: null, icono: null, orden: 1, incluyeComida: true, incluyeTransporte: true, incluyeGuia: true }, Number(padre.cat_id));
    const attractions = new AttractionRepository(catalogDb);
    const [{ ciu_id: banos }] = stack.db['ms-location']
      ? await stack.db['ms-location'].dataSource.query(`SELECT ciu_id FROM ciudad WHERE ciu_nombre = 'Baños'`)
      : [{ ciu_id: 5 }];
    for (const [codigo, body] of [
      [ATTRACTION, { name: 'Rafting en Baños', slug: 'rafting-en-banos', ciu_id: banos, categorias: ['cat-rafting-200'], idiomas: ['es', 'en'], meeting_point: 'Parque central de Baños', inclusions: { includes_food: true, includes_transport: true, includes_guide: true }, itinerario: [{ stop_number: 1, time: '10:30', title: 'Salida', duration_minutes: 30 }] }],
      [OTHER_ATTRACTION, { name: 'Centro histórico de Quito', slug: 'centro-historico-quito', ciu_id: 1, categorias: ['cat-cultural-100'] }],
    ] as const) {
      const input = parseAttraction({ description: 'Experiencia de prueba', tipo: 'GUIDED_TOUR', latitude: -1.3964, longitude: -78.4247, duration_hours: 4, operador: 'OPE-BANOS', ...body });
      const atrId = await catalogDb.transaction((m) => attractions.insert(codigo, input.slug!, input, opeId, m));
      await attractions.setState(atrId, 'PUBLICADA');
      await attractions.applyPrices(codigo, { moneda: 'USD', adulto: PRICES.adult, nino: PRICES.child, senior: PRICES.senior, infante: PRICES.infant, estudiante: null });
    }
  }

  const pricingDb = stack.db['ms-pricing']?.dataSource;
  if (pricingDb) {
    const pricing = new PricingRepository(pricingDb);
    for (const codigo of [ATTRACTION, OTHER_ATTRACTION]) {
      await pricing.setPriceTable({ codigo, validFrom: today, prices: { ADULT: PRICES.adult, CHILD: PRICES.child, SENIOR: PRICES.senior, INFANT: PRICES.infant } }, today);
    }
  }

  const inventoryDb = stack.db['ms-inventory']?.dataSource;
  if (inventoryDb) {
    const schedules = new ScheduleRepository(inventoryDb);
    await schedules.createSchedule(ATTRACTION, result.times.holgado, 20, null);
    await schedules.createSchedule(ATTRACTION, result.times.ultimo, 1, null);
    await schedules.createSchedule(ATTRACTION, result.times.lleno, 2, null);
    await schedules.createSchedule(OTHER_ATTRACTION, '09:00:00', 30, null);
    await schedules.generateSlots(today, 10);
    await inventoryDb.query(`UPDATE disponibilidad SET dis_cupo_reservado = dis_cupo_total WHERE dis_slot_codigo = $1`, [result.slots.lleno]);
  }

  const identityDb = stack.db['ms-identity']?.dataSource;
  if (identityDb) {
    const clients = new ApiClientRepository(identityDb);
    result.partnerId = (await clients.create('BOOKING-PRUEBAS', 'Booking Prototipo', sha256(API_KEY))).id;
    const inactive = await clients.create('SOCIO-INACTIVO', 'Socio inactivo', sha256(INACTIVE_API_KEY));
    await clients.setActive(inactive.id, false);
    const usuId = await new UserRepository(identityDb).create(identityDb, { correo: 'ana@correo.com', password: 'x', nombre: 'Ana', apellido: 'Pérez', documento: null, telefono: null, fecha_nacimiento: null }, 'hash-no-usado');
    const sesId = await new SessionRepository(identityDb).create({ usuId, tokenHash: sha256(`refresh-${usuId}`), ip: null, userAgent: null, expiresInSeconds: 3600 });
    result.userJwt = await signAccessToken({ usuId, sesId, roles: ['CLIENTE'] }, SECRETS.jwt, 3600);
  }
  return result;
}
