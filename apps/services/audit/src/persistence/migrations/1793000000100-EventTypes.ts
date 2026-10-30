import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Eventos de dominio de los microservicios (plan, sección 6.1) y su proyección al feed público de
 * `GET /atracciones/eventos`. El orden indica en qué secuencia se publican los eventos públicos de un mismo evento.
 */
const TIPOS: { nombre: string; servicio: string; agregado: string; publicos?: string[] }[] = [
  { nombre: 'AtraccionActualizada', servicio: 'catalog', agregado: 'atraccion' },
  { nombre: 'AcuerdoPromocionActualizado', servicio: 'catalog', agregado: 'acuerdo_promocion' },
  { nombre: 'CupoBloqueado', servicio: 'inventory', agregado: 'turno' },
  { nombre: 'CupoLiberado', servicio: 'inventory', agregado: 'turno' },
  { nombre: 'DisponibilidadActualizada', servicio: 'inventory', agregado: 'turno', publicos: ['STOCK_ACTUALIZADO'] },
  { nombre: 'TarifaActualizada', servicio: 'inventory', agregado: 'tarifa' },
  { nombre: 'OrdenCreada', servicio: 'order', agregado: 'orden' },
  { nombre: 'OrdenConfirmada', servicio: 'order', agregado: 'orden' },
  { nombre: 'OrdenCancelada', servicio: 'order', agregado: 'orden' },
  { nombre: 'ReservaEmitida', servicio: 'booking', agregado: 'reserva', publicos: ['RESERVA_CREADA', 'RESERVA_CONFIRMADA'] },
  { nombre: 'ReservaCancelada', servicio: 'booking', agregado: 'reserva', publicos: ['RESERVA_CANCELADA'] },
  { nombre: 'CheckinRealizado', servicio: 'booking', agregado: 'reserva' },
  { nombre: 'PagoAprobado', servicio: 'payment', agregado: 'pago' },
  { nombre: 'PagoRechazado', servicio: 'payment', agregado: 'pago' },
  { nombre: 'ReembolsoEmitido', servicio: 'payment', agregado: 'reembolso' },
  { nombre: 'FacturaAutorizada', servicio: 'invoicing', agregado: 'factura' },
];

export class EventTypes1793000000100 implements MigrationInterface {
  name = 'EventTypes1793000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const tipo of TIPOS) {
      await queryRunner.query(
        `INSERT INTO tipo_evento (nombre, servicio_origen, tipo_agregado) VALUES ($1, $2, $3) ON CONFLICT (nombre) DO NOTHING`,
        [tipo.nombre, tipo.servicio, tipo.agregado],
      );
      for (const [i, publico] of (tipo.publicos ?? []).entries()) {
        await queryRunner.query(
          `INSERT INTO tipo_evento_publico (tipo_evento, tipo_publico, orden) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [tipo.nombre, publico, i + 1],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM tipo_evento WHERE nombre = ANY($1::varchar[])`, [TIPOS.map((t) => t.nombre)]);
  }
}
