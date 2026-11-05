import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { migratedDatabase, sqlState, SQLSTATE, type ServiceDatabase } from './helpers';

/** Crea la base del servicio antes de las pruebas del bloque y la elimina al terminar. */
function useDatabase(service: Parameters<typeof migratedDatabase>[0]): () => DataSource {
  let db: ServiceDatabase;
  beforeAll(async () => {
    db = await migratedDatabase(service);
  });
  afterAll(async () => {
    await db?.drop();
  });
  return () => db.dataSource;
}

const CODIGO = 'PRhu4UBTWPBC';

describe('identity_db', () => {
  const ds = useDatabase('identity');

  const usuario = (email: string) =>
    ds().query(`INSERT INTO usuario (email, password_hash, nombre_completo, tipo) VALUES ($1, 'hash', 'Paúl Rosero', 'PERSONA') RETURNING id`, [email]);

  it('el correo es único sin distinguir mayúsculas', async () => {
    await usuario('paul.rosero@epn.edu.ec');
    expect(await sqlState(usuario('Paul.Rosero@EPN.edu.ec'))).toBe(SQLSTATE.unique);
  });

  it('carga los roles iniciales con sus scopes', async () => {
    const rows: { nombre: string; scopes: string[] }[] = await ds().query(
      `SELECT r.nombre, array_agg(s.scope ORDER BY s.scope) AS scopes FROM rol r JOIN rol_scope s ON s.rol_id = r.id GROUP BY r.nombre`,
    );
    const roles = Object.fromEntries(rows.map((r) => [r.nombre, r.scopes]));
    expect(Object.keys(roles).sort()).toEqual(['admin', 'cliente', 'guia', 'partner']);
    expect(roles.admin).toHaveLength(8);
    expect(roles.partner).toContain('attractions:book');
    expect(roles.partner).not.toContain('attractions:write');
    expect(roles.guia).toEqual(['attractions:checkin', 'attractions:read']);
  });

  it('rechaza scopes que no existen y documentos con formato inválido', async () => {
    const [rol] = await ds().query(`SELECT id FROM rol WHERE nombre = 'cliente'`);
    expect(await sqlState(ds().query(`INSERT INTO rol_scope (rol_id, scope) VALUES ($1, 'todo:permitido')`, [rol.id]))).toBe(SQLSTATE.check);

    const [u] = await usuario(`${randomUUID()}@example.com`);
    const dato = (tipo: string, numero: string) =>
      ds().query(
        `INSERT INTO dato_facturacion (usuario_id, tipo_documento, numero_documento, razon_social, email) VALUES ($1, $2, $3, 'Paúl Rosero', 'p@example.com')`,
        [u.id, tipo, numero],
      );
    expect(await sqlState(dato('CEDULA', '172345678'))).toBe(SQLSTATE.check);
    expect(await sqlState(dato('RUC', '1723456789'))).toBe(SQLSTATE.check);
    expect(await sqlState(dato('CEDULA', '1723456789'))).toBe('SIN_ERROR');
  });
});

describe('catalog_db', () => {
  const ds = useDatabase('catalog');
  let ids: { categoria: number; operador: string; ciudad: number };

  beforeAll(async () => {
    const [region] = await ds().query(`INSERT INTO region (nombre) VALUES ('Sierra') RETURNING id`);
    const [provincia] = await ds().query(`INSERT INTO provincia (region_id, nombre) VALUES ($1, 'Tungurahua') RETURNING id`, [region.id]);
    const [ciudad] = await ds().query(`INSERT INTO ciudad (provincia_id, nombre) VALUES ($1, 'Baños') RETURNING id`, [provincia.id]);
    const [categoria] = await ds().query(
      `INSERT INTO categoria (codigo, nombre, slug, incluye_comida, incluye_transporte, incluye_guia)
       VALUES ('cat-tours-100', 'Tours y Experiencias Guiadas', 'tours-experiencias', false, true, true) RETURNING id`,
    );
    const [operador] = await ds().query(
      `INSERT INTO operador (codigo, nombre_comercial, ruc, telefono_emergencia, email_soporte)
       VALUES ('proveedor-atracciones-dilan', 'TourGirls', '1792348123001', '+593991234567', 'soporte@tourgirls.com') RETURNING id`,
    );
    ids = { categoria: categoria.id, operador: operador.id, ciudad: ciudad.id };
  });

  const atraccion = (codigo: string, slug: string) =>
    ds().query(
      `INSERT INTO atraccion (codigo_publico, slug, nombre, descripcion_corta, descripcion, categoria_id, operador_id, ciudad_id,
                              duracion_horas, incluye_comida, incluye_transporte, incluye_guia, pe_direccion, pe_latitud, pe_longitud)
       VALUES ($1, $2, 'Tour Baños Aventura', 'Puenting y cascadas', 'Recorrido completo', $3, $4, $5, 7, false, true, true,
               'Parque central de Baños', -1.396, -78.424) RETURNING id`,
      [codigo, slug, ids.categoria, ids.operador, ids.ciudad],
    );

  it('no permite slugs que colisionan con las rutas del contrato', async () => {
    expect(await sqlState(atraccion('ABCDEFGHIJ01', 'reservas'))).toBe(SQLSTATE.check);
    expect(await sqlState(atraccion('ABCDEFGHIJ02', 'Con Mayusculas'))).toBe(SQLSTATE.check);
  });

  it('el código público es inmutable', async () => {
    const [a] = await atraccion(CODIGO, 'banos-aventura');
    expect(await sqlState(ds().query(`UPDATE atraccion SET codigo_publico = 'ZZZZZZZZZZZZ' WHERE id = $1`, [a.id]))).toBe(SQLSTATE.check);
    expect(await sqlState(ds().query(`UPDATE atraccion SET nombre = 'Otro nombre' WHERE id = $1`, [a.id]))).toBe('SIN_ERROR');
  });

  it('calcula la calificación con la vista materializada', async () => {
    const [{ id }] = await ds().query(`SELECT id FROM atraccion WHERE codigo_publico = $1`, [CODIGO]);
    for (const [general, pilar] of [[10, 9.8], [9, 9.6]]) {
      await ds().query(
        `INSERT INTO resena (reserva_id, atraccion_id, usuario_id, puntuacion_general, limpieza, servicio, calidad_precio, puntualidad)
         VALUES ($1, $2, $3, $4, $5, $5, $5, $5)`,
        [randomUUID(), id, randomUUID(), general, pilar],
      );
    }
    await ds().query(`REFRESH MATERIALIZED VIEW CONCURRENTLY v_atraccion_calificacion`);
    const [fila] = await ds().query(`SELECT total_resenas, puntuacion, limpieza FROM v_atraccion_calificacion WHERE atraccion_id = $1`, [id]);
    expect(fila).toEqual({ total_resenas: 2, puntuacion: '9.5', limpieza: '9.7' });
  });

  it('busca ciudades sin distinguir tildes ni mayúsculas', async () => {
    const rows = await ds().query(`SELECT nombre FROM ciudad WHERE lower(f_unaccent(nombre)) = lower(f_unaccent($1))`, ['BANOS']);
    expect(rows).toEqual([{ nombre: 'Baños' }]);
  });

  it('limita el descuento máximo del acuerdo de promociones a 50 %', async () => {
    const acuerdo = (porcentaje: number) =>
      ds().query(
        `INSERT INTO acuerdo_promocion (operador_id, permite_promociones, porcentaje_descuento_maximo, fecha_acuerdo, vigencia_hasta)
         VALUES ($1, true, $2, '2026-10-01', '2027-12-31')`,
        [ids.operador, porcentaje],
      );
    expect(await sqlState(acuerdo(60))).toBe(SQLSTATE.check);
    expect(await sqlState(acuerdo(15))).toBe('SIN_ERROR');
  });
});

describe('inventory_db', () => {
  const ds = useDatabase('inventory');
  const S = 'schema_atracciones';

  const tarifa = (desde: string, hasta: string | null, precios: [string, number][]) =>
    ds().transaction(async (m) => {
      const [t] = await m.query(`INSERT INTO ${S}.tarifa (atraccion_codigo, vigente_desde, vigente_hasta) VALUES ($1, $2, $3) RETURNING id`, [CODIGO, desde, hasta]);
      for (const [tipo, precio] of precios) {
        await m.query(`INSERT INTO ${S}.tarifa_precio (tarifa_id, tipo_boleto, precio) VALUES ($1, $2, $3)`, [t.id, tipo, precio]);
      }
      return t.id as string;
    });
  const COMPLETA: [string, number][] = [['ADULT', 30], ['CHILD', 15], ['SENIOR', 18], ['INFANT', 0]];

  it('no permite vender más cupos de los que tiene el turno', async () => {
    const [turno] = await ds().query(
      `INSERT INTO ${S}.turnos_aforo (atraccion_codigo, fecha, hora, cupos_totales) VALUES ($1, '2026-10-25', '10:30', 5) RETURNING id`,
      [CODIGO],
    );
    const reservar = (n: number) =>
      ds().query(
        `UPDATE ${S}.turnos_aforo SET cupos_reservados = cupos_reservados + $2
          WHERE id = $1 AND cupos_totales - cupos_reservados >= $2 RETURNING cupos_reservados`,
        [turno.id, n],
      );
    expect((await reservar(3))[1]).toBe(1);
    expect((await reservar(3))[1]).toBe(0); // sin cupos suficientes → 409 OUT_OF_STOCK en la API
    expect(await sqlState(ds().query(`UPDATE ${S}.turnos_aforo SET cupos_reservados = 6 WHERE id = $1`, [turno.id]))).toBe(SQLSTATE.check);
  });

  it('exige que la tarifa tenga los precios obligatorios del contrato', async () => {
    expect(await sqlState(tarifa('2026-01-01', '2026-06-30', [['ADULT', 30], ['CHILD', 15]]))).toBe(SQLSTATE.check);
    expect(await sqlState(tarifa('2026-01-01', '2026-06-30', [['ADULT', 0], ['CHILD', 15], ['SENIOR', 18], ['INFANT', 0]]))).toBe(SQLSTATE.check);
    expect(await sqlState(tarifa('2026-01-01', '2026-06-30', COMPLETA))).toBe('SIN_ERROR');
  });

  it('no permite borrar un precio obligatorio de una tarifa', async () => {
    const id = await tarifa('2025-01-01', '2025-12-31', COMPLETA);
    const borrar = ds().transaction((m) => m.query(`DELETE FROM ${S}.tarifa_precio WHERE tarifa_id = $1 AND tipo_boleto = 'CHILD'`, [id]));
    expect(await sqlState(borrar)).toBe(SQLSTATE.check);
    // Borrar la tarifa completa (con sus precios en cascada) sí está permitido.
    expect(await sqlState(ds().transaction((m) => m.query(`DELETE FROM ${S}.tarifa WHERE id = $1`, [id])))).toBe('SIN_ERROR');
  });

  it('no permite dos tarifas vigentes el mismo día para la misma atracción', async () => {
    await tarifa('2027-01-01', null, COMPLETA);
    expect(await sqlState(tarifa('2027-06-01', '2027-06-30', COMPLETA))).toBe(SQLSTATE.exclusion);
  });

  it('exige available_units en PushStockUpdate y delta en StreamInventoryChanges', async () => {
    const [turno] = await ds().query(
      `INSERT INTO ${S}.turnos_aforo (atraccion_codigo, fecha, hora, cupos_totales) VALUES ($1, '2026-10-26', '10:30', 5) RETURNING id`,
      [CODIGO],
    );
    const envio = (metodo: string, cupos: number | null, delta: number | null) =>
      ds().query(
        `INSERT INTO ${S}.sincronizacion_booking (event_id, turno_id, metodo, cupos_disponibles, delta, correlation_id) VALUES ($1, $2, $3, $4, $5, 'cid-1')`,
        [randomUUID(), turno.id, metodo, cupos, delta],
      );
    expect(await sqlState(envio('PUSH', null, -2))).toBe(SQLSTATE.check);
    expect(await sqlState(envio('PUSH', 3, null))).toBe('SIN_ERROR');
    expect(await sqlState(envio('STREAM', null, -2))).toBe('SIN_ERROR');
  });
});

describe('cart_db', () => {
  const ds = useDatabase('cart');

  it('un usuario tiene un solo carrito activo', async () => {
    const usuario = randomUUID();
    const carrito = () => ds().query(`INSERT INTO carrito (usuario_id, expira_en) VALUES ($1, now() + interval '1 day')`, [usuario]);
    await carrito();
    expect(await sqlState(carrito())).toBe(SQLSTATE.unique);
  });
});

describe('order_db', () => {
  const ds = useDatabase('order');

  const crearOrden = (boletos: [string, number, number][], descuento = 0) =>
    ds().transaction(async (m) => {
      const [orden] = await m.query(
        `INSERT INTO orden (codigo_externo, principal_tipo, principal_id, metodo_pago, correlation_id)
         VALUES ($1, 'API_CLIENTE', $2, 'SOA_BOOKING_GATEWAY', 'cid-1') RETURNING id`,
        [`ORD-${randomUUID().slice(0, 8)}`, randomUUID()],
      );
      const [detalle] = await m.query(
        `INSERT INTO orden_detalle (orden_id, atraccion_codigo, fecha, hora) VALUES ($1, $2, '2026-10-25', '10:30') RETURNING id`,
        [orden.id, CODIGO],
      );
      for (const [tipo, cantidad, precio] of boletos) {
        await m.query(`INSERT INTO orden_detalle_boleto (orden_detalle_id, tipo_boleto, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)`, [
          detalle.id, tipo, cantidad, precio,
        ]);
      }
      if (descuento > 0) {
        const [cupon] = await m.query(
          `INSERT INTO cupon (codigo, tipo, valor, vigente_desde, vigente_hasta) VALUES ($1, 'MONTO', $2, '2026-01-01', '2026-12-31') RETURNING id`,
          [`C-${randomUUID().slice(0, 8)}`, descuento],
        );
        await m.query(`INSERT INTO orden_cupon (orden_id, cupon_id, monto_descuento) VALUES ($1, $2, $3)`, [orden.id, cupon.id, descuento]);
      }
      return orden.id as string;
    });

  it('exige al menos un boleto de adulto por detalle (adult_count ≥ 1)', async () => {
    expect(await sqlState(crearOrden([['CHILD', 1, 15]]))).toBe(SQLSTATE.check);
  });

  it('calcula el total de la orden con la vista', async () => {
    const id = await crearOrden([['ADULT', 2, 30], ['CHILD', 1, 15], ['INFANT', 1, 0]], 5);
    const [total] = await ds().query(`SELECT subtotal, descuento, total FROM v_orden_total WHERE orden_id = $1`, [id]);
    expect(total).toEqual({ subtotal: '75.00', descuento: '5.00', total: '70.00' });
  });

  it('la misma Idempotency-Key no se registra dos veces para el mismo principal y operación', async () => {
    const principal = randomUUID();
    const clave = randomUUID();
    const registrar = () =>
      ds().query(
        `INSERT INTO idempotencia (principal_tipo, principal_id, operacion, clave, hash_solicitud, expira_en)
         VALUES ('API_CLIENTE', $1, 'create-reservation', $2, repeat('A', 64), now() + interval '24 hours')`,
        [principal, clave],
      );
    await registrar();
    expect(await sqlState(registrar())).toBe(SQLSTATE.unique);
  });
});

describe('booking_db', () => {
  const ds = useDatabase('booking');

  const reserva = (m: { query: DataSource['query'] }, estado: string, documento = '1723456789') =>
    m.query(
      `INSERT INTO reserva (codigo_pnr, codigo_externo_orden, principal_tipo, principal_id, atraccion_codigo, fecha, hora, estado, total,
                            titular_nombre, titular_email, titular_telefono, titular_tipo_documento, titular_numero_documento,
                            guia_codigo, punto_encuentro)
       VALUES ($1, $2, 'API_CLIENTE', $3, $4, '2026-10-25', '10:30', $5, 75, 'Paúl Rosero', 'paul.rosero@epn.edu.ec', '+593991234567',
               'CEDULA', $6, 'GUIA-CARLOS-01', 'Boulevard Naciones Unidas y Av. Shyris') RETURNING id`,
      [`DEC-${randomUUID().slice(0, 6).toUpperCase()}`, `ORD-${randomUUID().slice(0, 8)}`, randomUUID(), CODIGO, estado, documento],
    );

  it('valida el documento del titular', async () => {
    expect(await sqlState(reserva(ds(), 'CONFIRMED', '12345'))).toBe(SQLSTATE.check);
  });

  it('una reserva CANCELLED debe tener su cancelación y una CHECKED_IN su check-in', async () => {
    expect(await sqlState(ds().transaction((m) => reserva(m, 'CANCELLED')))).toBe(SQLSTATE.check);
    expect(await sqlState(ds().transaction((m) => reserva(m, 'CHECKED_IN')))).toBe(SQLSTATE.check);

    const cancelada = ds().transaction(async (m) => {
      const [r] = await reserva(m, 'CANCELLED');
      await m.query(
        `INSERT INTO reserva_cancelacion (reserva_id, motivo, solicitante, cancelado_en, reembolso_codigo, monto_reembolsado)
         VALUES ($1, 'SAGA_COMPENSATION_PARTNER_FAILURE', 'SAGA_ORCHESTRATOR', now(), 'REF-ATR-7F3K9Q', 75)`,
        [r.id],
      );
    });
    expect(await sqlState(cancelada)).toBe('SIN_ERROR');
  });

  it('pasar a CHECKED_IN junto con el registro del check-in es válido', async () => {
    const [r] = await reserva(ds(), 'CONFIRMED');
    const checkin = ds().transaction(async (m) => {
      await m.query(
        `INSERT INTO reserva_checkin (reserva_id, realizado_en, guia_codigo, documento_presentado) VALUES ($1, now(), 'GUIA-CARLOS-01', '1723456789')`,
        [r.id],
      );
      await m.query(`UPDATE reserva SET estado = 'CHECKED_IN' WHERE id = $1`, [r.id]);
    });
    expect(await sqlState(checkin)).toBe('SIN_ERROR');
  });
});

describe('payment_db', () => {
  const ds = useDatabase('payment');

  it('carga los cuatro métodos de pago del contrato', async () => {
    const rows = await ds().query(`SELECT codigo FROM metodo_pago ORDER BY codigo`);
    expect(rows.map((r: { codigo: string }) => r.codigo)).toEqual(['PAGO_EN_SITIO', 'SOA_BOOKING_GATEWAY', 'TARJETA_CREDITO', 'TRANSFERENCIA']);
  });

  it('calcula el saldo con los reembolsos emitidos', async () => {
    const [pago] = await ds().query(
      `INSERT INTO pago (orden_id, metodo_pago, estado, monto, clave_idempotencia) VALUES ($1, 'SOA_BOOKING_GATEWAY', 'APROBADO', 100, $2) RETURNING id`,
      [randomUUID(), randomUUID()],
    );
    const reembolso = (monto: number, estado: string) =>
      ds().query(
        `INSERT INTO reembolso (codigo, pago_id, monto, motivo, solicitante, estado, clave_idempotencia, emitido_en)
         VALUES ($1, $2, $3, 'Cancelación', 'CLIENTE', $4, $5, $6)`,
        [`REF-${randomUUID().slice(0, 8)}`, pago.id, monto, estado, randomUUID(), estado === 'EMITIDO' ? new Date() : null],
      );
    await reembolso(30, 'EMITIDO');
    await reembolso(10, 'PENDIENTE');
    const [saldo] = await ds().query(`SELECT reembolsado, saldo FROM v_pago_saldo WHERE pago_id = $1`, [pago.id]);
    expect(saldo).toEqual({ reembolsado: '30.00', saldo: '70.00' });
  });

  it('un pago rechazado debe tener motivo', async () => {
    const rechazado = ds().query(
      `INSERT INTO pago (orden_id, metodo_pago, estado, monto, clave_idempotencia) VALUES ($1, 'TARJETA_CREDITO', 'RECHAZADO', 10, $2)`,
      [randomUUID(), randomUUID()],
    );
    expect(await sqlState(rechazado)).toBe(SQLSTATE.check);
  });
});

describe('invoicing_db', () => {
  const ds = useDatabase('invoicing');

  it('calcula subtotales, IVA y total desde el detalle', async () => {
    const [factura] = await ds().query(
      `INSERT INTO factura (orden_id, tipo_comprobante, establecimiento, punto_emision, secuencial, clave_acceso, ambiente,
                            comprador_tipo_identificacion, comprador_identificacion, comprador_razon_social, correlation_id)
       VALUES ($1, 'FACTURA', '001', '001', '000000001', repeat('1', 49), 'PRUEBAS', '05', '1723456789', 'Paúl Rosero', 'cid-1') RETURNING id`,
      [randomUUID()],
    );
    const linea = (cantidad: number, precio: number, iva: string) =>
      ds().query(
        `INSERT INTO factura_detalle (factura_id, codigo_principal, descripcion, cantidad, precio_unitario, codigo_tarifa_iva)
         VALUES ($1, $2, 'Boleto', $3, $4, $5)`,
        [factura.id, CODIGO, cantidad, precio, iva],
      );
    await linea(2, 10, '4');
    await linea(1, 5, '0');
    const [totales] = await ds().query(`SELECT subtotal_sin_iva, subtotal_con_iva, iva, total FROM v_factura_totales WHERE factura_id = $1`, [factura.id]);
    expect(totales).toEqual({ subtotal_sin_iva: '5.00', subtotal_con_iva: '20.00', iva: '3.00', total: '28.00' });
  });
});

describe('audit_db', () => {
  const ds = useDatabase('audit');

  it('ReservaEmitida se publica como RESERVA_CREADA y luego RESERVA_CONFIRMADA', async () => {
    const rows = await ds().query(`SELECT tipo_publico FROM tipo_evento_publico WHERE tipo_evento = 'ReservaEmitida' ORDER BY orden`);
    expect(rows.map((r: { tipo_publico: string }) => r.tipo_publico)).toEqual(['RESERVA_CREADA', 'RESERVA_CONFIRMADA']);
  });

  it('la bitácora solo acepta tipos de evento registrados y el feed solo los cuatro tipos del contrato', async () => {
    const bitacora = ds().query(
      `INSERT INTO bitacora (event_id, tipo_evento, agregado_id, correlation_id, payload, ocurrido_en) VALUES ($1, 'EventoInventado', 'x', 'cid-1', '{}', now())`,
      [randomUUID()],
    );
    expect(await sqlState(bitacora)).toBe(SQLSTATE.foreignKey);
    const feed = (tipo: string) =>
      ds().query(
        `INSERT INTO evento_integracion (event_id, event_type, aggregate_id, correlation_id, ocurrido_en, payload) VALUES ($1, $2, 'DEC-7F3K9Q', 'cid-1', now(), '{}')`,
        [randomUUID(), tipo],
      );
    expect(await sqlState(feed('CHECKIN_REALIZADO'))).toBe(SQLSTATE.check);
    expect(await sqlState(feed('RESERVA_CREADA'))).toBe('SIN_ERROR');
  });
});
