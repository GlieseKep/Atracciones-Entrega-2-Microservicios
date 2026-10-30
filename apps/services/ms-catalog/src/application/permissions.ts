import { AppError, hasRole, requirePrincipal } from '@atracciones/platform';
import type { OperatorRepository } from '../persistence/operator-repository';

/** Quién administra: `opeIds` es `null` para `ADMIN`, o los operadores de un `OPERADOR`. */
export interface Staff {
  opeIds: number[] | null;
}

export class Permissions {
  constructor(
    private readonly secret: string,
    private readonly operators: OperatorRepository,
  ) {}

  async requireAdmin(): Promise<void> {
    const principal = await requirePrincipal(this.secret);
    if (!hasRole(principal, 'ADMIN')) throw AppError.forbidden('Esta operación requiere el rol ADMIN.');
  }

  async requireStaff(): Promise<Staff> {
    const principal = await requirePrincipal(this.secret);
    if (hasRole(principal, 'ADMIN')) return { opeIds: null };
    if (!hasRole(principal, 'OPERADOR')) throw AppError.forbidden('Esta operación requiere el rol ADMIN u OPERADOR.');
    return { opeIds: await this.operators.operatorIdsOf(Number(principal.id)) };
  }

  /** Un `OPERADOR` solo actúa sobre su operador. */
  assertOperator(staff: Staff, opeId: number): void {
    if (staff.opeIds && !staff.opeIds.includes(opeId)) throw AppError.forbidden('Este recurso pertenece a otro operador.');
  }
}
