import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Check, Lock } from 'lucide-react';
import { getMyCustomer, updateMyCustomer } from '@/api/customers';
import { Button } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { BillingForm } from '@/components/profile/BillingForm';
import { PaymentMethodSelector } from '@/components/purchase/PaymentMethodSelector';
import { PurchaseForm } from '@/components/purchase/PurchaseForm';
import { PurchaseSummary } from '@/components/purchase/PurchaseSummary';
import { Step } from '@/components/reservation/ReservationForm';
import { ReservationSummary } from '@/components/reservation/ReservationSummary';
import { useAsync } from '@/hooks/useAsync';
import { useAttraction } from '@/hooks/useAttractions';
import { useAuth } from '@/hooks/useAuth';
import { usePurchase } from '@/hooks/usePurchase';
import { usePurchaseStore, type PurchaseSelection, type PurchaseStep } from '@/stores/purchaseStore';
import { useRecentOrdersStore } from '@/stores/recentOrdersStore';
import { useUiStore } from '@/stores/uiStore';
import type { UpdateCustomerRequest } from '@/types/identity';
import type { PaymentMethod } from '@/types/payment';
import { errorMessage, isApiError } from '@/utils/api';
import { isNotPast, isValidLocalTime } from '@/utils/dates';
import { paths } from '@/utils/routes';

const STEPS: { id: PurchaseStep; label: string }[] = [
  { id: 'select', label: 'Actividad' },
  { id: 'billing', label: 'Facturación' },
  { id: 'review', label: 'Pago' },
];

/**
 * Compra directa sin carrito (checkout de Viator en 3 pasos):
 * 1) fecha/horario/cantidad, 2) datos de facturación + creación del pedido con precio del servidor,
 * 3) método de pago simulado → resultado y enlace al pedido.
 */
export default function PurchasePage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const notify = useUiStore((s) => s.notify);
  const attraction = useAttraction(id);
  const { user, claims, signIn } = useAuth();
  const store = usePurchaseStore();
  const { confirm, pay } = usePurchase(id);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const customer = useAsync((signal) => getMyCustomer(signal).catch((e) => (isApiError(e, 'notFound') ? null : Promise.reject(e))), [id]);
  const [savingBilling, setSavingBilling] = useState(false);
  const [billingError, setBillingError] = useState<unknown>(null);

  // Inicializa la selección desde la URL (viene de la caja de reserva del detalle).
  useEffect(() => {
    const date = params.get('fecha') ?? '';
    const time = params.get('hora') ?? '';
    store.reset();
    store.setSelection({
      attractionId: id,
      date: isNotPast(date) ? date : '',
      time: isValidLocalTime(time) ? time : '',
      quantity: Math.min(100, Math.max(1, Number(params.get('cantidad')) || 1)),
    });
    return () => store.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (attraction.status === 'error') {
    return (
      <div className="page-container pt-10">
        <ErrorState error={attraction.error} onRetry={attraction.retry} onLogin={() => signIn()} />
      </div>
    );
  }
  const a = attraction.data;
  const sel = store.selection;
  if (!a || !sel) return <div className="page-container skeleton mt-10 h-96" aria-busy="true" />;

  const saveBillingAndConfirm = async (body: UpdateCustomerRequest) => {
    setSavingBilling(true);
    setBillingError(null);
    try {
      customer.setData(await updateMyCustomer(body));
    } catch (e) {
      setBillingError(e);
      setSavingBilling(false);
      return;
    }
    setSavingBilling(false);
    try {
      const purchase = await confirm.run({ date: sel.date, time: sel.time, quantity: sel.quantity });
      useRecentOrdersStore.getState().add(purchase.orderId);
      store.setPurchase(purchase);
    } catch (e) {
      if (isApiError(e, 'availability')) store.goTo('select');
    }
  };

  const submitPayment = async () => {
    if (!store.purchase || !method) return;
    try {
      const payment = await pay.run({
        orderId: store.purchase.orderId,
        paymentMethod: method,
        amount: store.purchase.totalAmount,
        currency: store.purchase.currency,
      });
      if (payment.status === 'AUTHORIZED' || payment.status === 'SETTLED') {
        notify('¡Pago aprobado! Tu pedido está confirmado.', 'success');
        navigate(paths.order(store.purchase.orderId), { replace: true });
      } else {
        store.setPayment(payment);
      }
    } catch {
      /* se muestra en el paso */
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === store.step);
  const rejected = store.payment && !['AUTHORIZED', 'SETTLED'].includes(store.payment.status);

  return (
    <div className="page-container pt-4">
      <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: a.name, to: paths.attraction(a.id) }, { label: 'Comprar' }]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">Finaliza tu compra</h1>
        <p className="flex items-center gap-1.5 text-sm text-ink-soft">
          <Lock size={14} aria-hidden="true" /> Pago simulado seguro
        </p>
      </div>

      <ol className="mt-6 flex items-center gap-2 text-sm font-semibold" aria-label="Pasos de la compra">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2" aria-current={i === Math.min(stepIndex, 2) ? 'step' : undefined}>
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                i < stepIndex || store.step === 'done' ? 'bg-success text-white' : i === stepIndex ? 'bg-ink text-white' : 'bg-surface text-ink-muted'
              }`}
            >
              {i < stepIndex || store.step === 'done' ? <Check size={14} aria-hidden="true" /> : i + 1}
            </span>
            <span className={i === stepIndex ? 'text-ink' : 'text-ink-muted'}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line sm:w-12" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {store.step === 'select' && (
            <Step n={1} title="Elige fecha, horario y entradas">
              {!!confirm.error && <Alert tone="error" className="mb-4">{errorMessage(confirm.error)}</Alert>}
              <PurchaseForm
                attractionId={a.id}
                initial={sel}
                onChange={(patch) => store.setSelection({ ...sel, ...patch } as PurchaseSelection)}
                onContinue={(s) => {
                  store.setSelection(s);
                  confirm.clearError();
                  store.goTo('billing');
                }}
              />
            </Step>
          )}

          {store.step === 'billing' && (
            <Step n={2} title="Datos de facturación">
              {customer.status === 'loading' ? (
                <div className="skeleton h-48" aria-busy="true" />
              ) : customer.status === 'error' ? (
                <ErrorState error={customer.error} onRetry={customer.retry} />
              ) : (
                <>
                  <BillingForm
                    customer={customer.data}
                    fallbackEmail={user?.email ?? claims?.email}
                    submitLabel="Confirmar pedido"
                    submitting={savingBilling || confirm.pending}
                    error={billingError ?? confirm.error}
                    onSubmit={saveBillingAndConfirm}
                    secondaryAction={
                      <Button variant="tertiary" onClick={() => store.goTo('select')}>
                        Volver
                      </Button>
                    }
                  />
                  <p className="mt-4 text-xs text-ink-muted">
                    Al confirmar, el servidor valida la disponibilidad, calcula el precio y retiene tus plazas temporalmente.
                  </p>
                </>
              )}
            </Step>
          )}

          {(store.step === 'review' || store.step === 'done') && store.purchase && (
            <Step n={3} title="Método de pago">
              <PurchaseSummary purchase={store.purchase} />
              <div className="mt-6">
                <PaymentMethodSelector value={method} onChange={setMethod} />
              </div>
              {rejected && (
                <Alert tone="error" className="mt-4">
                  El pago simulado fue {store.payment?.status === 'REJECTED' ? 'rechazado' : 'no completado'}. Puedes intentarlo de nuevo
                  con otro método mientras tus plazas sigan retenidas.
                </Alert>
              )}
              {!!pay.error && <Alert tone="error" className="mt-4">{errorMessage(pay.error)}</Alert>}
              <div className="mt-6 flex flex-wrap justify-between gap-3">
                <Button variant="tertiary" onClick={() => navigate(paths.order(store.purchase!.orderId))}>
                  Pagar más tarde
                </Button>
                <Button size="lg" disabled={!method} loading={pay.pending} onClick={submitPayment}>
                  Pagar {store.purchase.totalAmount.toLocaleString('es-EC', { style: 'currency', currency: store.purchase.currency })}
                </Button>
              </div>
            </Step>
          )}
        </div>

        <div className="lg:sticky lg:top-36 lg:self-start">
          <ReservationSummary
            attraction={a}
            date={sel.date}
            time={sel.time}
            quantity={sel.quantity}
            confirmedTotal={store.purchase ? { amount: store.purchase.totalAmount, currency: store.purchase.currency } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
