import { randomInt } from 'node:crypto';
import { AppError, type EsbClient } from '@atracciones/platform';
import type { DataSource, EntityManager } from 'typeorm';
import type { AttractionInput, AttractionState, LogisticaReserva, ReferenciaAtraccion } from '../contract';
import type { AdminFilters, AttractionRepository, AttractionRow } from '../persistence/attraction-repository';
import type { GuideRepository } from '../persistence/guide-repository';
import type { OperatorRepository } from '../persistence/operator-repository';
import { isReservedSlug, slugify } from './attraction-input';
import { childrenOf, meetingPoint, toAdmin, toDetail } from './attraction-mapper';
import type { Locations } from './locations';
import type { Permissions, Staff } from './permissions';
import { paginationOf } from './search';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const newCode = () => Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const notFound = (id: string) => AppError.notFound(`No existe la atracción ${id}.`, 'ATTRACTION_NOT_FOUND');

const publicRow = (row: AttractionRow | null): AttractionRow | null => (row?.atr_estado === 'PUBLICADA' ? row : null);

export class AttractionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly attractions: AttractionRepository,
    private readonly operators: OperatorRepository,
    private readonly guides: GuideRepository,
    private readonly locations: Locations,
    private readonly permissions: Permissions,
    private readonly esb: EsbClient,
  ) {}

  // Consulta -------------------------------------------------------------------

  async publicDetail(id: string) {
    const row = publicRow(await this.attractions.findByPublicId(id));
    if (!row) throw notFound(id);
    const [cities, children] = await Promise.all([this.locations.names([row.ciu_id]), this.attractions.children([row.atr_id])]);
    return toDetail(row, cities.get(row.ciu_id) ?? '', children);
  }

  async reference(id: string): Promise<ReferenciaAtraccion> {
    const row = publicRow(await this.attractions.findByPublicId(id));
    if (!row) throw notFound(id);
    return { atr_id: Number(row.atr_id), id: row.atr_codigo, slug: row.atr_slug, nombre: row.atr_nombre };
  }

  /** Sin `guiId` asigna el primer guía activo del operador. Si se pide uno que no sirve, responde `404`. */
  async logistics(id: string, guiId: number | null): Promise<LogisticaReserva> {
    const row = publicRow(await this.attractions.findByPublicId(id));
    if (!row) throw notFound(id);
    const guia = await this.guides.forReservation(Number(row.ope_id), guiId);
    if (guiId !== null && !guia) throw AppError.notFound(`El guía ${guiId} no está disponible para esta atracción.`, 'GUIDE_NOT_FOUND');
    return {
      atraccion_id: row.atr_codigo,
      nombre: row.atr_nombre,
      punto_encuentro: meetingPoint(row),
      free_cancellation: row.atr_cancelacion_gratuita,
      deadline_hours: row.atr_horas_cancelacion,
      guia,
    };
  }

  // Administración -------------------------------------------------------------

  private async toAdminDto(row: AttractionRow) {
    const [cities, children] = await Promise.all([this.locations.names([row.ciu_id]), this.attractions.children([row.atr_id])]);
    return toAdmin(row, cities.get(row.ciu_id) ?? '', children);
  }

  private async owned(id: string, staff: Staff): Promise<AttractionRow> {
    const row = await this.attractions.findByPublicId(id);
    if (!row) throw notFound(id);
    this.permissions.assertOperator(staff, Number(row.ope_id));
    return row;
  }

  async adminList(filters: Omit<AdminFilters, 'opeIds'>, page: number, limit: number, staff: Staff) {
    const { total, rows } = await this.attractions.adminList({ ...filters, opeIds: staff.opeIds }, page, limit);
    const [cities, children] = await Promise.all([
      this.locations.names(rows.map((row) => row.ciu_id)),
      this.attractions.children(rows.map((row) => row.atr_id)),
    ]);
    return {
      metadata: paginationOf(total, page, limit),
      data: rows.map((row) => toAdmin(row, cities.get(row.ciu_id) ?? '', childrenOf(children, row.atr_id))),
    };
  }

  async adminGet(id: string, staff: Staff) {
    return this.toAdminDto(await this.owned(id, staff));
  }

  /** Referencias de la entrada; devuelve el operador. */
  private async validateReferences(input: AttractionInput, staff: Staff): Promise<number> {
    const opeId = await this.operators.idByCode(input.operador);
    if (opeId === null) throw AppError.unprocessable('OPERATOR_NOT_FOUND', `No existe el operador ${input.operador}.`, [{ name: 'operador', reason: 'Operador desconocido.' }]);
    this.permissions.assertOperator(staff, opeId);
    const problems = [
      ...(await this.attractions.missingCategories(input.categorias)).map((codigo) => ({ name: 'categorias', reason: `Categoría desconocida o inactiva: ${codigo}.` })),
      ...(await this.attractions.missingLanguages(input.idiomas)).map((codigo) => ({ name: 'idiomas', reason: `Idioma desconocido: ${codigo}.` })),
      ...(await this.attractions.missingInclusions(input.inclusiones)).map((id) => ({ name: 'inclusiones', reason: `Inclusión desconocida: ${id}.` })),
    ];
    if (problems.length > 0) throw AppError.unprocessable('INVALID_REFERENCE', 'La atracción tiene referencias inválidas.', problems);
    await this.locations.assertCity(input.ciuId);
    return opeId;
  }

  private async generatedSlug(input: AttractionInput, codigo: string, m: EntityManager): Promise<string> {
    if (input.slug) return input.slug;
    const base = slugify(input.nombre) || codigo.toLowerCase();
    const taken = isReservedSlug(base) || (await this.attractions.slugExists(base, m));
    return taken ? `${base}-${codigo.toLowerCase()}` : base;
  }

  async create(input: AttractionInput, staff: Staff) {
    const opeId = await this.validateReferences(input, staff);
    const codigo = newCode();
    await this.dataSource.transaction(async (m) => {
      await this.attractions.insert(codigo, await this.generatedSlug(input, codigo, m), input, opeId, m);
    });
    return this.toAdminDto((await this.attractions.findByPublicId(codigo)) as AttractionRow);
  }

  async update(id: string, input: AttractionInput, staff: Staff) {
    const row = await this.owned(id, staff);
    const opeId = await this.validateReferences(input, staff);
    await this.dataSource.transaction(async (m) => {
      await this.attractions.update(row.atr_id, input.slug ?? row.atr_slug, input, opeId, m);
      if (row.atr_estado === 'PUBLICADA') await this.assertPublishable(row.atr_codigo, m);
    });
    return this.toAdminDto((await this.attractions.findByPublicId(row.atr_codigo)) as AttractionRow);
  }

  private async assertPublishable(codigo: string, db: DataSource | EntityManager): Promise<void> {
    const row = (await this.attractions.findByPublicId(codigo, db)) as AttractionRow;
    const children = await this.attractions.children([row.atr_id], db);
    const missing: string[] = [];
    if (children.categorias.length === 0) missing.push('una categoría');
    if (children.fotos.length === 0) missing.push('una foto');
    if ([row.atr_precio_adulto, row.atr_precio_nino, row.atr_precio_senior, row.atr_precio_infante].includes(null)) missing.push('una tarifa');
    if (missing.length > 0) throw AppError.unprocessable('ATTRACTION_NOT_PUBLISHABLE', `Para publicar falta: ${missing.join(', ')}.`);
  }

  async setState(id: string, estado: AttractionState, staff: Staff) {
    const row = await this.owned(id, staff);
    if (estado === 'PUBLICADA') await this.assertPublishable(row.atr_codigo, this.dataSource);
    await this.attractions.setState(row.atr_id, estado);
    return this.toAdminDto((await this.attractions.findByPublicId(row.atr_codigo)) as AttractionRow);
  }

  async remove(id: string, staff: Staff): Promise<void> {
    await this.attractions.softDelete((await this.owned(id, staff)).atr_id);
  }

  /** Comprueba que un usuario exista en Identity. */
  async assertUser(usuId: number): Promise<void> {
    const found = await this.esb.call<unknown[]>('identity', 'getUsers', { ids: [usuId] });
    if (found.length === 0) throw AppError.validation(`No existe el usuario ${usuId}.`, [{ name: 'usu_id', reason: 'Usuario desconocido.' }]);
  }
}
