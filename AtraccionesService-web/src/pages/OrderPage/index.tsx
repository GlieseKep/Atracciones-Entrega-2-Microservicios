import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, CheckCircle2, CircleDot, Receipt } from 'lucide-react';
import { cancelOrder, getOrder, getOrderEvents } from '@/api/orders';
import { simulatePayment } from '@/api/payments';
import { Button, ButtonLink } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { TextArea } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { OrderStatusBadge, PaymentStatusBadge, orderStatusLabel } from '@/components/profile/StatusBadge';
import { PaymentMethodSelector } from '@/components/purchase/PaymentMethodSelector';
import { useAsync } from '@/hooks/useAsync';
import { useAllAttractions } from '@/hooks/useAttractions';
import { useIdempotentMutation } from '@/hooks/useReservations';
import { useUiStore } from '@/stores/uiStore';
import type { Order, OrderStatus } from '@/types/order';
import type { CreatePaymentSimulationRequest, PaymentMethod, PaymentSimulation } from '@/types/payment';
import { errorMessage } from '@/utils/api';
import { formatDate, formatDateTime } from '@/utils/dates';
import { formatMoney, shortCode } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import { cancelReasonSchema, type CancelReasonValues } from '@/utils/validation';

const EVENT_LABEL: Record<string, string> = {
  ORDER_CREATED: 'Pedido creado',
  PAYMENT_REQUESTED: 'Pago solicitado',
  PAYMENT_AUTHORIZED: 'Pago autorizado',
  PAYMENT_SETTLED: 'Pago liquidado',
  PAYMENT_REJECTED: 'Pago rechazado',
  ORDER_CANCELLED: 'Pedido cancelado',
};

const CANCELLABLE: OrderStatus[] = ['PENDING_PAYMENT', 'PAID'];

/** Detalle del pedido: estado, resumen de pago, código de seguimiento e historial de eventos. */
export default function OrderPage() {
  const { orderId = '' } = useParams();
  const order = useAsync((signal) => getOrder(orderId, signal), [orderId]);
  const events = useAsync((signal) => getOrderEvents(orderId, signal), [orderId, order.data?.status]);
  const catalog = useAllAttractions();
  const [cancelOpen, setCancelOpen] = useState(false);

  if (order.status === 'error') {
    return (
      <div className="page-container pt-10">
        <ErrorState error={order.error} onRetry={order.retry} />
      </div>
    );
  }
  if (!order.data) return <div className="page-container skeleton mt-10 h-96" aria-busy="true" />;

  const o = order.data;
  const nameOf = (id: string) => catalog.data?.find((a) => a.id === id)?.name ?? 'Experiencia';
  const paid = o.status === 'PAID' || o.status === 'FULFILLED';

  return (
    <div className="page-container max-w-4xl pt-4">
      <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Pedidos', to: paths.profile('pedidos') }, { label: `#${shortCode(o.id)}` }]} />

      {paid && (
        <div className="mt-6 flex items-center gap-3 rounded-md bg-[#EEF7F2] p-4 text-success" role="status">
          <CheckCircle2 size={28} aria-hidden="true" />
          <p className="font-semibold">¡Gracias por tu compra! Tu pedido está {orderStatusLabel(o.status).toLowerCase()}.</p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-ink-muted">Código de seguimiento</p>
          <h1 className="text-3xl">Pedido #{shortCode(o.id)}</h1>
          <p className="mt-1 text-sm text-ink-soft">Creado el {formatDateTime(o.createdAt)}</p>
        </div>
        <OrderStatusBadge status={o.status} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="card-surface p-5" aria-labelledby="items-title">
            <h2 id="items-title" className="text-lg">
              Experiencias
            </h2>
            <ul className="mt-4 divide-y divide-line">
              {o.items.map((item) => (
                <li key={item.id} className="flex flex-wrap justify-between gap-2 py-3">
                  <div>
                    <Link to={paths.attraction(item.attractionId)} className="font-semibold hover:underline">
                      {nameOf(item.attractionId)}
                    </Link>
                    <p className="flex items-center gap-1.5 text-sm text-ink-soft">
                      <CalendarDays size={14} aria-hidden="true" /> {formatDate(item.date)} · {item.time} · {item.quantity} entradas
                    </p>
                  </div>
                  <p className="font-semibold">{formatMoney(item.unitPrice.total * item.quantity, item.unitPrice.currency)}</p>
                </li>
              ))}
            </ul>
            <div className="flex justify-between border-t border-line pt-3 text-lg font-extrabold">
              <span>Total</span>
              <span>{formatMoney(o.totalAmount, o.currency)}</span>
            </div>
          </section>

          {o.status === 'PENDING_PAYMENT' && <PayPanel order={o} onPaid={order.retry} />}

          <section className="card-surface p-5" aria-labelledby="events-title">
            <h2 id="events-title" className="text-lg">
              Historial del pedido
            </h2>
            {events.status === 'error' ? (
              <ErrorState error={events.error} onRetry={events.retry} className="mt-4 py-6" />
            ) : !events.data ? (
              <div className="skeleton mt-4 h-24" />
            ) : (
              <ol className="mt-4 space-y-4 border-l-2 border-line pl-5">
                {events.data.events.map((e, i) => (
                  <li key={`${e.eventType}-${i}`} className="relative">
                    <CircleDot size={16} className="absolute -left-[29px] top-0.5 bg-white text-brand-500" aria-hidden="true" />
                    <p className="font-semibold">{EVENT_LABEL[e.eventType] ?? e.eventType}</p>
                    <p className="text-sm text-ink-soft">
                      {formatDateTime(e.createdAt)}
                      {e.previousStatus && ` · ${orderStatusLabel(e.previousStatus as OrderStatus)} → ${orderStatusLabel(e.newStatus as OrderStatus)}`}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card-surface p-5" aria-labelledby="payment-title">
            <h2 id="payment-title" className="flex items-center gap-2 text-lg">
              <Receipt size={18} aria-hidden="true" /> Pago
            </h2>
            {o.paymentSimulation ? (
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Estado</dt>
                  <dd>
                    <PaymentStatusBadge status={o.paymentSimulation.status} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Método</dt>
                  <dd>{o.paymentSimulation.paymentMethod === 'CARD' ? 'Tarjeta (simulada)' : 'Transferencia (simulada)'}</dd>
                </div>
                {o.paymentSimulation.gatewayReference && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-soft">Referencia</dt>
                    <dd className="truncate font-mono">{o.paymentSimulation.gatewayReference}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">Aún no hay pagos registrados.</p>
            )}
          </section>
          {o.reservationId && (
            <ButtonLink to={paths.reservation(o.reservationId)} variant="secondary" fullWidth>
              Ver reserva asociada
            </ButtonLink>
          )}
          {CANCELLABLE.includes(o.status) && (
            <Button variant="danger" fullWidth onClick={() => setCancelOpen(true)}>
              Cancelar pedido
            </Button>
          )}
        </aside>
      </div>

      <CancelOrderDialog open={cancelOpen} order={o} onClose={() => setCancelOpen(false)} onDone={(u) => (order.setData(u), setCancelOpen(false))} />
    </div>
  );
}

function PayPanel({ order, onPaid }: { order: Order; onPaid: () => void }) {
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const notify = useUiStore((s) => s.notify);
  const [result, setResult] = useState<PaymentSimulation | null>(null);
  const { run, pending, error } = useIdempotentMutation<CreatePaymentSimulationRequest, PaymentSimulation>(
    useCallback((body, key) => simulatePayment(body, key), []),
  );

  const pay = async () => {
    if (!method) return;
    try {
      const payment = await run({ orderId: order.id, paymentMethod: method, amount: order.totalAmount, currency: order.currency });
      setResult(payment);
      if (payment.status === 'AUTHORIZED' || payment.status === 'SETTLED') {
        notify('¡Pago aprobado!', 'success');
        onPaid();
      }
    } catch {
      /* se muestra abajo */
    }
  };

  return (
    <section className="card-surface p-5" aria-labelledby="pay-title">
      <h2 id="pay-title" className="mb-4 text-lg">
        Completar pago
      </h2>
      <PaymentMethodSelector value={method} onChange={setMethod} />
      {result && !['AUTHORIZED', 'SETTLED'].includes(result.status) && (
        <Alert tone="error" className="mt-4">
          El pago simulado no se completó. Puedes intentarlo de nuevo.
        </Alert>
      )}
      {!!error && <Alert tone="error" className="mt-4">{errorMessage(error)}</Alert>}
      <div className="mt-5 flex justify-end">
        <Button size="lg" disabled={!method} loading={pending} onClick={pay}>
          Pagar {formatMoney(order.totalAmount, order.currency)}
        </Button>
      </div>
    </section>
  );
}

function CancelOrderDialog({ open, order, onClose, onDone }: { open: boolean; order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const notify = useUiStore((s) => s.notify);
  const { run, pending, error } = useIdempotentMutation<string, Order>(useCallback((reason, key) => cancelOrder(order.id, reason, key), [order.id]));
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CancelReasonValues>({ resolver: zodResolver(cancelReasonSchema) });

  const submit = handleSubmit(async ({ reason }) => {
    try {
      const updated = await run(reason.trim());
      notify('Pedido cancelado.', 'success');
      onDone(updated);
    } catch {
      /* se muestra abajo */
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancelar pedido"
      size="sm"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Volver
          </Button>
          <Button variant="danger" loading={pending} onClick={submit}>
            Confirmar cancelación
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-ink-soft">
          {order.status === 'PAID'
            ? 'Si el pedido está pagado, el reembolso simulado se procesará según la política de cancelación.'
            : 'Se liberarán las plazas retenidas para este pedido.'}
        </p>
        <TextArea label="Motivo" error={errors.reason?.message} {...register('reason')} />
        {!!error && <Alert tone="error">{errorMessage(error)}</Alert>}
      </form>
    </Modal>
  );
}
