import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, RotateCcw } from 'lucide-react';
import { adminApi, type AdminOrder, type AdminOrderDetail } from '@/api/admin';
import { Button } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { Input, TextArea } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { OrderStatusBadge, PaymentStatusBadge, ReservationStatusBadge } from '@/components/profile/StatusBadge';
import { useAsync } from '@/hooks/useAsync';
import { useIdempotentMutation } from '@/hooks/useReservations';
import { useUiStore } from '@/stores/uiStore';
import { errorMessage } from '@/utils/api';
import { formatDate, formatDateTime } from '@/utils/dates';
import { formatMoney, shortCode } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import { AdminTable, Sub, type Column } from './AdminTable';

const ORDER_STATUSES = [
  { value: 'PENDING_PAYMENT', label: 'Pendiente de pago' },
  { value: 'PAID', label: 'Pagado' },
  { value: 'CANCELLED', label: 'Cancelado' },
  { value: 'PARTIALLY_REFUNDED', label: 'Reembolso parcial' },
  { value: 'REFUNDED', label: 'Reembolsado' },
];

const EVENT_LABEL: Record<string, string> = {
  ORDER_CREATED: 'Pedido creado',
  PAYMENT_SETTLED: 'Pago liquidado',
  ORDER_CANCELLED: 'Pedido cancelado',
  ORDER_PARTIALLY_REFUNDED: 'Reembolso parcial',
  ORDER_REFUNDED: 'Reembolso total',
  PAYMENT_REQUESTED: 'Pago solicitado',
  PAYMENT_AUTHORIZED: 'Pago autorizado',
  PAYMENT_REJECTED: 'Pago rechazado',
  PAYMENT_FAILED: 'Pago fallido',
  PAYMENT_PARTIALLY_REFUNDED: 'Reembolso parcial',
  PAYMENT_REFUNDED: 'Reembolso total',
};

/** Tiempo restante de la retención de cupos de un pedido pendiente; se actualiza cada 30 s. */
function HoldStatus({ holdExpiresAt }: { holdExpiresAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!holdExpiresAt) return null;
  const minutes = Math.ceil((new Date(holdExpiresAt).getTime() - now) / 60_000);
  return minutes > 0 ? (
    <span className="block text-xs text-warning">Retención: {minutes} min</span>
  ) : (
    <span className="block text-xs text-danger">Retención vencida</span>
  );
}

const columns = (open: (id: string) => void): Column<AdminOrder>[] => [
  {
    header: 'Pedido',
    cell: (o) => (
      <button type="button" className="font-mono text-xs font-semibold text-brand-600 hover:underline" onClick={() => open(o.id)}>
        {shortCode(o.id)}
      </button>
    ),
  },
  { header: 'Cliente', cell: (o) => o.customerEmail },
  {
    header: 'Atracción',
    cell: (o) => (
      <>
        {o.attractionName ?? '—'}
        {o.serviceDate && <Sub>{`${formatDate(o.serviceDate)} · ${o.serviceTime} · ${o.quantity} ${o.quantity === 1 ? 'entrada' : 'entradas'}`}</Sub>}
      </>
    ),
  },
  {
    header: 'Total',
    align: 'right',
    cell: (o) => (
      <>
        {formatMoney(o.total.amount, o.total.currency)}
        {o.refunded > 0 && <Sub>Reembolsado {formatMoney(o.refunded, o.total.currency)}</Sub>}
      </>
    ),
  },
  {
    header: 'Estado',
    cell: (o) => (
      <>
        <OrderStatusBadge status={o.status} />
        {o.status === 'PENDING_PAYMENT' && <HoldStatus holdExpiresAt={o.holdExpiresAt} />}
      </>
    ),
  },
  { header: 'Pago', cell: (o) => (o.paymentStatus ? <PaymentStatusBadge status={o.paymentStatus} /> : <span className="text-ink-muted">Sin pago</span>) },
  { header: 'Creado', cell: (o) => <span className="text-xs">{formatDateTime(o.createdAt)}</span> },
];

/** Pedidos: el lado del dinero de cada compra. Detalle con historial y pagos, cancelación de pendientes y reembolsos. */
export default function AdminOrdersPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('pedido');
  const [reloadKey, setReloadKey] = useState(0);
  const open = (id: string) => setParams((p) => (p.set('pedido', id), p));
  const close = () => setParams((p) => (p.delete('pedido'), p));

  return (
    <>
      <AdminTable
        title="Pedidos"
        load={adminApi.orders}
        columns={columns(open)}
        rowKey={(o) => o.id}
        searchPlaceholder="Correo, código o atracción"
        statuses={ORDER_STATUSES}
        dateLabel="Creado"
        reloadKey={reloadKey}
      />
      {selected && <OrderDialog orderId={selected} onClose={close} onChanged={() => setReloadKey((n) => n + 1)} />}
    </>
  );
}

function OrderDialog({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged: () => void }) {
  const detail = useAsync((signal) => adminApi.order(orderId, signal), [orderId]);
  const [action, setAction] = useState<'cancel' | 'refund' | null>(null);
  const order = detail.data;

  const updated = (next: AdminOrderDetail) => {
    detail.setData(next);
    setAction(null);
    onChanged();
  };

  const remaining = order ? Math.round((order.total.amount - order.refunded) * 100) / 100 : 0;
  const canCancel = order?.status === 'PENDING_PAYMENT';
  const canRefund = (order?.status === 'PAID' || order?.status === 'PARTIALLY_REFUNDED') && remaining > 0;

  return (
    <Modal
      open
      size="lg"
      title={order ? `Pedido ${shortCode(order.id)}` : 'Pedido'}
      onClose={onClose}
      footer={
        <>
          {canCancel && !action && (
            <Button variant="danger" onClick={() => setAction('cancel')}>
              <Ban size={16} aria-hidden="true" /> Cancelar pedido
            </Button>
          )}
          {canRefund && !action && (
            <Button variant="secondary" onClick={() => setAction('refund')}>
              <RotateCcw size={16} aria-hidden="true" /> Reembolsar
            </Button>
          )}
          <Button variant="tertiary" onClick={onClose}>Cerrar</Button>
        </>
      }
    >
      {detail.status === 'error' ? (
        <ErrorState error={detail.error} onRetry={detail.retry} />
      ) : !order ? (
        <div className="skeleton h-64" aria-busy="true" />
      ) : (
        <div className="space-y-6">
          {action === 'cancel' && <CancelForm order={order} onDone={updated} onBack={() => setAction(null)} />}
          {action === 'refund' && <RefundForm order={order} remaining={remaining} onDone={updated} onBack={() => setAction(null)} />}

          <section className="flex flex-wrap items-center gap-3">
            <OrderStatusBadge status={order.status} />
            {order.status === 'PENDING_PAYMENT' && <HoldStatus holdExpiresAt={order.holdExpiresAt} />}
            <span className="ml-auto text-right">
              <span className="text-xl font-extrabold">{formatMoney(order.total.amount, order.total.currency)}</span>
              {order.refunded > 0 && <Sub>Reembolsado {formatMoney(order.refunded, order.total.currency)} · Pendiente {formatMoney(remaining, order.total.currency)}</Sub>}
            </span>
          </section>
          {order.cancellationReason && <Alert tone="info">Motivo de cancelación: {order.cancellationReason}</Alert>}

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-soft">Cliente</dt>
              <dd className="font-semibold">{order.customerName ?? '—'}<Sub>{order.customerEmail}</Sub></dd>
            </div>
            <div>
              <dt className="text-ink-soft">Reserva vinculada</dt>
              <dd className="flex items-center gap-2">
                {order.reservationId ? (
                  <>
                    <span className="font-mono text-xs">{shortCode(order.reservationId)}</span>
                    {order.reservationStatus && <ReservationStatusBadge status={order.reservationStatus} />}
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">Creado</dt>
              <dd>{formatDateTime(order.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">Última actualización</dt>
              <dd>{formatDateTime(order.updatedAt)}</dd>
            </div>
          </dl>

          <section>
            <h3 className="font-semibold">Elementos</h3>
            <ul className="mt-2 divide-y divide-line rounded-sm border border-line text-sm">
              {order.items.map((i) => (
                <li key={`${i.attractionId}-${i.serviceDate}-${i.serviceTime}`} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span>
                    <Link to={paths.attraction(i.attractionId)} className="font-semibold hover:underline">{i.attractionName}</Link>
                    <Sub>{`${formatDate(i.serviceDate)} · ${i.serviceTime}`}</Sub>
                  </span>
                  <span className="text-right">
                    {i.quantity} × {formatMoney(i.unitPrice.amount, i.unitPrice.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="font-semibold">Historial del pedido</h3>
            <ol className="mt-2 space-y-2 border-l-2 border-line pl-4 text-sm">
              {order.events.map((e, n) => (
                <li key={n}>
                  <span className="font-semibold">{EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                  <Sub>{formatDateTime(e.createdAt)}</Sub>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h3 className="font-semibold">Pagos</h3>
            {order.payments.length === 0 ? (
              <p className="mt-1 text-sm text-ink-soft">Todavía no hay intentos de pago.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {order.payments.map((p) => (
                  <li key={p.id} className="rounded-sm border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{p.gatewayReference}</span>
                      <PaymentStatusBadge status={p.status} />
                      <span className="ml-auto font-semibold">{formatMoney(p.amount.amount, p.amount.currency)}</span>
                    </div>
                    <Sub>
                      {p.paymentMethod === 'CARD' ? 'Tarjeta' : 'Transferencia'} · {formatDateTime(p.createdAt)}
                      {p.failureReason ? ` · ${p.failureReason}` : ''}
                      {p.refunded > 0 ? ` · Reembolsado ${formatMoney(p.refunded, p.amount.currency)}` : ''}
                    </Sub>
                    <ul className="mt-2 space-y-1 text-xs text-ink-soft">
                      {p.attemptsDetail.map((a) => (
                        <li key={a.attemptNumber}>
                          Intento {a.attemptNumber}: {a.responseMessage} (código {a.responseCode})
                        </li>
                      ))}
                      {p.events
                        .filter((e) => e.amount !== null)
                        .map((e, n) => (
                          <li key={n}>
                            {EVENT_LABEL[e.eventType] ?? e.eventType}: {formatMoney(e.amount!, p.amount.currency)} — {e.reason} ({formatDateTime(e.createdAt)})
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

interface FormProps {
  order: AdminOrderDetail;
  onDone: (order: AdminOrderDetail) => void;
  onBack: () => void;
}

function CancelForm({ order, onDone, onBack }: FormProps) {
  const notify = useUiStore((s) => s.notify);
  const [reason, setReason] = useState('');
  const { run, pending, error } = useIdempotentMutation<string, AdminOrderDetail>(
    useCallback((text, key) => adminApi.cancelOrder(order.id, text, key), [order.id]),
  );
  const submit = async () => {
    try {
      onDone(await run(reason.trim()));
      notify('Pedido cancelado y cupos liberados.', 'success');
    } catch {
      /* el error se muestra en el formulario */
    }
  };
  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 p-4">
      <h3 className="font-semibold">Cancelar pedido pendiente</h3>
      <p className="mt-1 text-sm text-ink-soft">Se liberan los cupos de la franja y se cancela la reserva vinculada. No se puede deshacer.</p>
      {error ? <Alert tone="error" className="mt-3">{errorMessage(error)}</Alert> : null}
      <TextArea className="mt-3" label="Motivo" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      <div className="mt-3 flex gap-2">
        <Button variant="danger" loading={pending} disabled={reason.trim().length < 3} onClick={submit}>Confirmar cancelación</Button>
        <Button variant="tertiary" onClick={onBack}>Volver</Button>
      </div>
    </div>
  );
}

function RefundForm({ order, remaining, onDone, onBack }: FormProps & { remaining: number }) {
  const notify = useUiStore((s) => s.notify);
  const [kind, setKind] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const value = Number(amount);
  const amountError =
    kind === 'partial' && amount !== '' && (!(value > 0) || Math.round(value * 100) !== value * 100 || value > remaining)
      ? `Indica un importe entre 0,01 y ${remaining.toFixed(2)} con como máximo dos decimales.`
      : undefined;
  const valid = reason.trim().length >= 3 && (kind === 'full' || (amount !== '' && !amountError));
  const { run, pending, error } = useIdempotentMutation<{ amount?: number; reason: string }, AdminOrderDetail>(
    useCallback((body, key) => adminApi.refundOrder(order.id, body, key), [order.id]),
  );
  const submit = async () => {
    try {
      const result = await run({ amount: kind === 'partial' ? value : undefined, reason: reason.trim() });
      onDone(result);
      notify(result.status === 'REFUNDED' ? 'Reembolso total registrado; la reserva quedó cancelada.' : 'Reembolso parcial registrado.', 'success');
    } catch {
      /* el error se muestra en el formulario */
    }
  };
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <h3 className="font-semibold">Reembolso simulado</h3>
      <p className="mt-1 text-sm text-ink-soft">
        Pendiente de devolver: <strong>{formatMoney(remaining, order.total.currency)}</strong>. El reembolso total cancela la reserva y libera los
        cupos; el parcial no cambia las entradas.
      </p>
      {error ? <Alert tone="error" className="mt-3">{errorMessage(error)}</Alert> : null}
      <fieldset className="mt-3 flex gap-4 text-sm">
        <legend className="sr-only">Tipo de reembolso</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="refund-kind" checked={kind === 'full'} onChange={() => setKind('full')} /> Total
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="refund-kind" checked={kind === 'partial'} onChange={() => setKind('partial')} /> Parcial
        </label>
      </fieldset>
      {kind === 'partial' && (
        <Input
          className="mt-3 max-w-xs"
          label={`Importe (${order.total.currency})`}
          type="number"
          step="0.01"
          min={0.01}
          max={remaining}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={amountError}
        />
      )}
      <TextArea className="mt-3" label="Motivo" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      <div className="mt-3 flex gap-2">
        <Button loading={pending} disabled={!valid} onClick={submit}>
          Reembolsar {kind === 'full' ? formatMoney(remaining, order.total.currency) : amount && !amountError ? formatMoney(value, order.total.currency) : ''}
        </Button>
        <Button variant="tertiary" onClick={onBack}>Volver</Button>
      </div>
    </div>
  );
}
