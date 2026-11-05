import { AppError, hasRole, requirePrincipal, type Principal } from '@atracciones/platform';
import type { ReservaResponse } from '../contract';
import type { ReservationRepository, ReservationRow } from '../persistence/reservation-repository';
import { toResponse } from './reservation-mapper';
import type { Remote } from './remote';

const notFound = (id: string) => AppError.notFound(`No existe la reserva ${id}.`, 'RESERVATION_NOT_FOUND');

/** Consulta de reservas y control del dueño. La reserva no guarda usuario: el dueño está en la orden. */
export class ReservationService {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly remote: Remote,
    private readonly secret: string,
    private readonly basePath: string,
  ) {}

  principal(): Promise<Principal> {
    return requirePrincipal(this.secret);
  }

  async require(id: string): Promise<ReservationRow> {
    const row = await this.reservations.find(id);
    if (!row) throw notFound(id);
    return row;
  }

  async assertOwner(row: ReservationRow, principal: Principal): Promise<void> {
    if (hasRole(principal, 'ADMIN')) return;
    const order = await this.remote.order({ ord_numero: row.ord_numero });
    const owner = principal.tipo === 'USUARIO' ? order.usu_id : order.cla_id;
    if (Number(owner) !== Number(principal.id)) throw AppError.forbidden('La reserva pertenece a otro usuario.');
  }

  /** Fecha y hora salen de Inventory, y guía y punto de encuentro, de Catalog. */
  async present(row: ReservationRow): Promise<ReservaResponse> {
    const slot = await this.remote.slot(Number(row.dis_id));
    const logistics = await this.remote.logisticsOrNull(slot.atraccion_id, row.gui_id === null ? null : Number(row.gui_id));
    return toResponse(row, slot, logistics, this.basePath);
  }

  /**
   * Consultar: el dueño o un `ADMIN`, y para el check-in también un `GUIA` o el `OPERADOR` de la atracción. Cancelar sigue
   * usando solo `assertOwner`.
   */
  private async assertCanView(row: ReservationRow, principal: Principal): Promise<void> {
    if (hasRole(principal, 'GUIA')) return;
    try {
      await this.assertOwner(row, principal);
    } catch (error) {
      if (!(error instanceof AppError && error.status === 403 && hasRole(principal, 'OPERADOR'))) throw error;
      await this.remote.assertOperatorOf((await this.remote.slot(Number(row.dis_id))).atraccion_id);
    }
  }

  async get(id: string): Promise<ReservaResponse> {
    const principal = await this.principal();
    const row = await this.require(id);
    await this.assertCanView(row, principal);
    return this.present(row);
  }

  /** Cada quien ve las suyas, a partir de sus órdenes; `todas` es solo para `ADMIN`. */
  async list(todas: boolean, estado: string, page: number, limit: number) {
    const principal = await this.principal();
    const size = Math.min(limit || 20, 50);
    if (todas) {
      if (!hasRole(principal, 'ADMIN')) throw AppError.forbidden('Ver todas las reservas requiere el rol ADMIN.');
      const { total, rows } = await this.reservations.list(estado || null, page || 1, size);
      return { total_results: total, items: await Promise.all(rows.map((row) => this.present(row))) };
    }
    const orders = await this.remote.myOrders(page || 1, size);
    const numeros = (orders.items ?? []).map((order) => order.ord_numero);
    const rows = numeros.length === 0 ? [] : await this.reservations.listByOrders(numeros);
    const filtered = estado ? rows.filter((row) => row.est_codigo === estado) : rows;
    return { total_results: orders.total_results ?? 0, items: await Promise.all(filtered.map((row) => this.present(row))) };
  }
}
