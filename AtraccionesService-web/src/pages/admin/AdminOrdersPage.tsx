import { useState } from 'react';
import { getOrder, getOrderInvoice } from '@/api/orders';
import { operationsApi } from '@/api/admin';
import { Button } from '@/components/common/Button';
import { ErrorState } from '@/components/common/Feedback';
import { Modal } from '@/components/common/Modal';
import { OrderStatusBadge } from '@/components/profile/StatusBadge';
import { useAsync } from '@/hooks/useAsync';
import type { OrderState, OrderSummary } from '@/types/order';
import { errorMessage, isApiError } from '@/utils/api';
import { formatDateTime } from '@/utils/dates';
import { formatMoney, lineAttractionName } from '@/utils/formatters';
import { AdminTable, Sub, type Column } from './AdminTable';

const ORDER_STATES: { value: OrderState; label: string }[] = [
  { value: 'CREADA', label: 'Creadas' },
  { value: 'PAGADA', label: 'Pagadas' },
  { value: 'CANCELADA', label: 'Canceladas' },
  { value: 'REEMBOLSADA', label: 'Reembolsadas' },
];

const TICKET_LABEL: Record<string, string> = { ADULT: 'Adulto', CHILD: 'Niño', SENIOR: 'Adulto mayor', INFANT: 'Infante', STUDENT: 'Estudiante' };

/**
 * Órdenes de ms-order (las crea Booking en cada compra). Solo consulta: no hay reembolsos, y para cancelar una compra web
 * se usa Reservas (Booking libera los cupos y cancela la orden si no está pagada).
 */
export default function AdminOrdersPage() {
  const [selected, setSelected] = useState<OrderSummary | null>(null);

  const columns: Column<OrderSummary>[] = [
    {
      header: 'Orden',
      cell: (o) => (
        <button type="button" className="text-left font-semibold hover:underline" onClick={() => setSelected(o)}>
          {o.ord_numero}
          <Sub>#{o.ord_id}</Sub>
        </button>
      ),
    },
    { header: 'Subtotal', align: 'right', cell: (o) => formatMoney(o.subtotal, o.moneda) },
    { header: 'Descuento', align: 'right', cell: (o) => (o.descuento > 0 ? `−${formatMoney(o.descuento, o.moneda)}` : '—') },
    { header: 'IVA', align: 'right', cell: (o) => formatMoney(o.iva, o.moneda) },
    { header: 'Total', align: 'right', cell: (o) => <strong>{formatMoney(o.total, o.moneda)}</strong> },
    { header: 'Estado', cell: (o) => <OrderStatusBadge status={o.estado} /> },
    {
      header: '',
      align: 'right',
      cell: (o) => (
        <Button size="sm" variant="secondary" onClick={() => setSelected(o)}>
          Ver
        </Button>
      ),
    },
  ];

  return (
    <>
      <AdminTable
        title="Pedidos"
        load={(p, signal) => operationsApi.orders({ page: p.page, limit: p.limit, estado: (p.status as OrderState | '') ?? '' }, signal)}
        columns={columns}
        rowKey={(o) => String(o.ord_id)}
        statuses={ORDER_STATES}
      />
      {selected && <OrderDialog order={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function OrderDialog({ order, onClose }: { order: OrderSummary; onClose: () => void }) {
  const detail = useAsync((signal) => getOrder(order.ord_numero, signal), [order.ord_numero]);
  const invoice = useAsync((signal) => getOrderInvoice(order.ord_id, signal), [order.ord_id]);
  const d = detail.data;

  return (
    <Modal open onClose={onClose} title={`Orden ${order.ord_numero}`} size="lg">
      {detail.status === 'error' ? (
        <ErrorState error={detail.error} onRetry={detail.retry} />
      ) : !d ? (
        <div className="skeleton h-64" aria-busy="true" />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">
              {formatDateTime(d.fecha)} · {d.metodo}
            </p>
            <OrderStatusBadge status={d.orden.estado} />
          </div>

          <section>
            <h3 className="text-base">{d.lineas[0] ? lineAttractionName(d.lineas[0].descripcion) : 'Líneas'}</h3>
            <ul className="mt-2 divide-y divide-line text-sm">
              {d.lineas.map((line) => (
                <li key={line.det_id} className="flex justify-between gap-3 py-2">
                  <span>
                    {TICKET_LABEL[line.ticket_type] ?? line.ticket_type} × {line.cantidad}{' '}
                    <span className="text-ink-muted">({formatMoney(line.precio_unitario, d.orden.moneda)} c/u)</span>
                  </span>
                  <span className="font-semibold">{formatMoney(line.subtotal, d.orden.moneda)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 space-y-1 border-t border-line pt-2 text-sm">
              <Row label="Subtotal" value={formatMoney(d.orden.subtotal, d.orden.moneda)} />
              {d.orden.descuento > 0 && <Row label="Descuento" value={`−${formatMoney(d.orden.descuento, d.orden.moneda)}`} />}
              <Row label="IVA" value={formatMoney(d.orden.iva, d.orden.moneda)} />
              <Row label="Total" value={formatMoney(d.orden.total, d.orden.moneda)} strong />
            </dl>
          </section>

          <section>
            <h3 className="text-base">Factura</h3>
            {invoice.status === 'loading' ? (
              <div className="skeleton mt-2 h-12" />
            ) : invoice.data ? (
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <Row label="Número" value={invoice.data.numero} />
                <Row label="SRI" value={invoice.data.estado_sri} />
                <Row label="A nombre de" value={`${invoice.data.razon_social} (${invoice.data.identificacion})`} />
                <Row label="Emitida" value={formatDateTime(invoice.data.emitida_en)} />
              </dl>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">
                {isApiError(invoice.error, 'notFound') ? 'La orden aún no tiene factura (se emite al pagarse).' : errorMessage(invoice.error)}
              </p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-extrabold' : ''}`}>
      <dt className="text-ink-soft">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
