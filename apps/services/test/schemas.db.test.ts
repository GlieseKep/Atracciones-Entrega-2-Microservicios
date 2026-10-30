import { migratedDatabase, relations, revertAll, type ServiceName } from './helpers';

/** Tablas y vistas de cada base, según BASE_DE_DATOS_MICROSERVICIOS.md (sección 14). */
const EXPECTED: Record<ServiceName, string[]> = {
  identity: ['api_cliente', 'api_cliente_scope', 'dato_facturacion', 'rol', 'rol_scope', 'sesion', 'token_verificacion', 'usuario', 'usuario_rol'],
  catalog: [
    'acuerdo_promocion', 'acuerdo_promocion_destino', 'atraccion', 'atraccion_foto', 'atraccion_idioma', 'categoria', 'ciudad', 'evento_procesado', 'foto',
    'idioma', 'inclusion', 'itinerario_parada', 'operador', 'outbox', 'provincia', 'region', 'resena', 'v_atraccion_calificacion',
  ],
  inventory: [
    'schema_atracciones.fecha_bloqueada', 'schema_atracciones.guia', 'schema_atracciones.horario', 'schema_atracciones.outbox',
    'schema_atracciones.reserva_cupo', 'schema_atracciones.sincronizacion_booking', 'schema_atracciones.tarifa',
    'schema_atracciones.tarifa_precio', 'schema_atracciones.turno_precio', 'schema_atracciones.turnos_aforo',
  ],
  cart: ['carrito', 'carrito_item', 'carrito_item_boleto', 'favorito'],
  order: ['cupon', 'idempotencia', 'orden', 'orden_cupon', 'orden_detalle', 'orden_detalle_boleto', 'orden_paso_saga', 'outbox', 'v_orden_total'],
  booking: [
    'idempotencia', 'outbox', 'reserva', 'reserva_boleto', 'reserva_cancelacion', 'reserva_checkin', 'reserva_historial_estado',
    'reserva_pasajero',
  ],
  payment: ['metodo_pago', 'outbox', 'pago', 'pago_tarjeta', 'pago_transferencia', 'reembolso', 'v_pago_saldo', 'webhook_recibido'],
  invoicing: ['factura', 'factura_detalle', 'factura_mensaje_sri', 'outbox', 'tarifa_iva', 'v_factura_totales'],
  audit: ['bitacora', 'evento_integracion', 'mensaje_contacto', 'tipo_evento', 'tipo_evento_publico'],
};

/** Tablas técnicas que cada servicio tiene con sus propios datos (no conectan módulos). */
const TECNICAS = ['outbox', 'idempotencia', 'evento_procesado'];

describe('aislamiento entre microservicios', () => {
  it('ninguna tabla de negocio está en más de una base y toda llave foránea une tablas del mismo servicio', async () => {
    const duenos = new Map<string, ServiceName[]>();
    for (const service of Object.keys(EXPECTED) as ServiceName[]) {
      const db = await migratedDatabase(service);
      try {
        const propias = await relations(db.dataSource);
        for (const tabla of propias) duenos.set(sinEsquema(tabla), [...(duenos.get(sinEsquema(tabla)) ?? []), service]);

        const fks: { desde: string; hacia: string }[] = await db.dataSource.query(
          `SELECT conrelid::regclass::text AS desde, confrelid::regclass::text AS hacia FROM pg_constraint WHERE contype = 'f'`,
        );
        for (const fk of fks) {
          expect({ servicio: service, fk, desdePropia: propias.includes(fk.desde), haciaPropia: propias.includes(fk.hacia) })
            .toEqual({ servicio: service, fk, desdePropia: true, haciaPropia: true });
        }
      } finally {
        await db.drop();
      }
    }
    const compartidas = [...duenos].filter(([tabla, servicios]) => servicios.length > 1 && !TECNICAS.includes(tabla));
    expect(compartidas).toEqual([]);
  });
});

const sinEsquema = (tabla: string) => tabla.slice(tabla.indexOf('.') + 1);

describe.each(Object.keys(EXPECTED) as ServiceName[])('migraciones de %s', (service) => {
  it('crea exactamente las tablas del modelo, se revierten por completo y se pueden volver a aplicar', async () => {
    const db = await migratedDatabase(service);
    try {
      expect(await relations(db.dataSource)).toEqual([...EXPECTED[service]].sort());

      await revertAll(db.dataSource);
      expect(await relations(db.dataSource)).toEqual([]);

      await db.dataSource.runMigrations({ transaction: 'each' });
      expect(await relations(db.dataSource)).toEqual([...EXPECTED[service]].sort());
    } finally {
      await db.drop();
    }
  });
});
