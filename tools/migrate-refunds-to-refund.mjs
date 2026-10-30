// Copia los reembolsos de Payment (payment_db.reembolso) a ms_refund.
// Plan/ms_refund/PLAN_IMPLEMENTACION.md, Fase 4.
//
// Uso:  npm run build && npm run db:migrate -- ms-refund && node tools/migrate-refunds-to-refund.mjs [--dry-run]
//
// Ejecutar con las cancelaciones detenidas (ventana corta), justo antes de cambiar la saga de Order a Refund.
//
// SERVICES_DATABASE_URL es la URL del servidor SIN nombre de base (igual que tools/migrate-services.mjs).
// Por defecto: postgres://postgres:tourgirls-local@localhost:5433/   DATABASE_SSL=true para Azure.
//
// - codigo → rem_numero, pago_id → pag_id, orden_id y moneda del pago, creado_en → rem_solicitado_en,
//   emitido_en → rem_procesado_en (los FALLIDO sin emitido_en toman creado_en; los PENDIENTE quedan sin fecha).
// - No vuelve a publicar ReembolsoEmitido: las notas de crédito de esos reembolsos ya existen.
// - Se puede repetir: un reembolso cuya clave ya está en ms_refund se salta.
// - Al final compara, por pago, lo reembolsado (EMITIDO) en las dos bases.
import pg from 'pg';

const base = (process.env.SERVICES_DATABASE_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433/').replace(/\/?$/, '/');
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
const dryRun = process.argv.includes('--dry-run');

const connect = async (database) => {
  const client = new pg.Client({ connectionString: `${base}${database}`, ssl });
  await client.connect();
  return client;
};
const payment = await connect('payment_db');
const refund = await connect('ms_refund');

const summary = { origen: 0, copiados: 0, ya_migrados: 0, pagos_con_diferencia: 0 };
try {
  const { rows } = await payment.query(
    `SELECT r.codigo, r.pago_id::text, p.orden_id::text, r.monto, p.moneda, left(r.motivo, 300) AS motivo, r.solicitante, r.estado,
            r.clave_idempotencia, r.creado_en,
            CASE WHEN r.estado = 'PENDIENTE' THEN NULL ELSE coalesce(r.emitido_en, r.creado_en) END AS procesado_en
       FROM reembolso r JOIN pago p ON p.id = r.pago_id
      ORDER BY r.creado_en`,
  );
  summary.origen = rows.length;

  if (dryRun) {
    console.log('[simulación] Resumen:', summary);
  } else {
    await refund.query('BEGIN');
    try {
      for (const r of rows) {
        const { rowCount } = await refund.query(
          `INSERT INTO reembolso (pag_id, ord_id, rem_numero, rem_monto, rem_moneda, rem_motivo, rem_solicitante, rem_estado,
             rem_clave_idempotencia, rem_solicitado_en, rem_procesado_en, rem_creado_en)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10)
           ON CONFLICT DO NOTHING`,
          [r.pago_id, r.orden_id, r.codigo, r.monto, r.moneda, r.motivo, r.solicitante, r.estado, r.clave_idempotencia, r.creado_en, r.procesado_en],
        );
        if (rowCount) summary.copiados++;
        else summary.ya_migrados++;
      }
      await refund.query('COMMIT');
    } catch (error) {
      await refund.query('ROLLBACK');
      throw error;
    }

    // Verificación: lo reembolsado por pago debe coincidir.
    const { rows: before } = await payment.query(`SELECT pago_id::text, reembolsado::text FROM v_pago_saldo WHERE reembolsado > 0`);
    const { rows: after } = await refund.query(`SELECT pag_id::text AS pago_id, emitido::text AS reembolsado FROM v_pago_reembolsado`);
    const migrated = new Map(after.map((r) => [r.pago_id, Number(r.reembolsado)]));
    for (const b of before) {
      const now = migrated.get(b.pago_id) ?? 0;
      if (Math.abs(now - Number(b.reembolsado)) > 0.001) {
        summary.pagos_con_diferencia++;
        console.warn(`[diferencia] pago ${b.pago_id}: Payment ${b.reembolsado}, ms_refund ${now}.`);
      }
    }
    console.log('Resumen:', summary);
    if (summary.pagos_con_diferencia) process.exitCode = 1;
  }
} finally {
  await payment.end();
  await refund.end();
}
