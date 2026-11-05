import { useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, ShieldCheck } from 'lucide-react';
import { listPaymentMethods, validateCoupon } from '@/api/payments';
import { Button } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { Input, TextArea } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { CheckoutSummary } from '@/components/purchase/CheckoutSummary';
import { PaymentMethodSelector } from '@/components/purchase/PaymentMethodSelector';
import { AvailabilityCalendar } from '@/components/reservation/AvailabilityCalendar';
import { AvailabilitySelector } from '@/components/reservation/AvailabilitySelector';
import { TicketSelector } from '@/components/reservation/TicketSelector';
import { parseCheckoutQuery, slotTime, toCheckoutQuery } from '@/features/attractions/checkoutQuery';
import { useAsync } from '@/hooks/useAsync';
import { useAttraction } from '@/hooks/useAttractions';
import { useAuth } from '@/hooks/useAuth';
import { useCreateReservation } from '@/hooks/useReservations';
import { useUiStore } from '@/stores/uiStore';
import type { TicketCounts } from '@/types/booking';
import type { User } from '@/types/identity';
import type { CouponValidation, PaymentMethodInfo } from '@/types/payment';
import { errorMessage, fieldError, isApiError } from '@/utils/api';
import { estimateTotal, ticketTotal } from '@/utils/formatters';
import { paths } from '@/utils/routes';
import { cardSchema, customerSchema, type CardValues, type CustomerValues } from '@/utils/validation';

const COUPON_REASONS: Record<string, string> = {
  COUPON_NOT_FOUND: 'El cupón no existe.',
  COUPON_INACTIVE: 'El cupón no está activo.',
  COUPON_NOT_STARTED: 'El cupón todavía no está vigente.',
  COUPON_EXPIRED: 'El cupón ya venció.',
};

/** Titular por defecto: los datos del perfil de ms-identity. */
function customerFrom(user: User | null): CustomerValues {
  const documento = user?.documento ?? '';
  return {
    full_name: user ? `${user.nombre} ${user.apellido}`.trim() : '',
    email: user?.correo ?? '',
    phone: user?.telefono ?? '',
    document_type: documento && !/^\d{10}$/.test(documento) ? 'PASAPORTE' : 'CEDULA',
    document_id: documento,
  };
}

/**
 * Compra en un solo paso: Booking crea la orden, reserva los cupos y procesa el pago (`bookingCreateReservation`).
 * Si el turno se agota entre la selección y el pago (409 `OUT_OF_STOCK`), no se cobra y se pide elegir otro horario.
 */
export default function CheckoutPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const attraction = useAttraction(id);
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const notify = useUiStore((s) => s.notify);
  const purchase = useCreateReservation();
  const methods = useAsync((signal) => listPaymentMethods(signal), []);

  const [initial] = useState(() => parseCheckoutQuery(params));
  const [date, setDate] = useState(initial.date);
  const [tickets, setTickets] = useState<TicketCounts>(initial.tickets);
  const [slot, setSlot] = useState(initial.slotId ? { slotId: initial.slotId, time: initial.time } : null);
  const [availabilityKey, setAvailabilityKey] = useState(0);
  const [method, setMethod] = useState<PaymentMethodInfo | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState<CouponValidation | null>(null);
  const [couponError, setCouponError] = useState('');
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [requirements, setRequirements] = useState('');
  const [acceptPolicy, setAcceptPolicy] = useState(false);
  const [formError, setFormError] = useState('');

  const customer = useForm<CustomerValues>({ resolver: zodResolver(customerSchema), mode: 'onTouched', defaultValues: customerFrom(user) });
  const card = useForm<CardValues>({ resolver: zodResolver(cardSchema), mode: 'onTouched', defaultValues: { marca: 'VISA', titular: customerFrom(user).full_name } });

  if (attraction.status === 'error') {
    return (
      <div className="page-container pt-10">
        <ErrorState error={attraction.error} onRetry={attraction.retry} onLogin={() => signIn()} />
      </div>
    );
  }
  if (!attraction.data) return <div className="page-container skeleton mt-10 h-96" aria-busy="true" />;
  const a = attraction.data;
  const quantity = ticketTotal(tickets);
  const subtotal = estimateTotal(a.price, tickets);

  /** Mantiene la selección en la URL para poder recargar o compartir el paso. */
  const select = (next: { date?: string; tickets?: TicketCounts; slot?: { slotId: string; time: string } | null }) => {
    const d = next.date ?? date;
    const t = next.tickets ?? tickets;
    const s = next.slot === undefined ? slot : next.slot;
    setParams(toCheckoutQuery({ date: d, slotId: s?.slotId ?? '', time: s?.time ?? '', tickets: t }), { replace: true });
  };

  const applyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) return;
    setCheckingCoupon(true);
    setCouponError('');
    try {
      const result = await validateCoupon({ code, subtotal, currency: a.price.currency, date: date || null });
      if (result.valid) setCoupon(result);
      else {
        setCoupon(null);
        setCouponError(COUPON_REASONS[result.reason ?? ''] ?? 'El cupón no es válido.');
      }
    } catch (error) {
      setCoupon(null);
      setCouponError(errorMessage(error));
    } finally {
      setCheckingCoupon(false);
    }
  };

  const submit = customer.handleSubmit(async (values) => {
    setFormError('');
    if (!date || !slot) return setFormError('Elige la fecha y el horario de la actividad.');
    if (!method) return setFormError('Elige un método de pago.');
    if (!acceptPolicy) return setFormError('Debes aceptar la política de cancelación y los términos de uso.');
    let tarjeta;
    if (method.requiere_datos) {
      if (!(await card.trigger())) return setFormError('Revisa los datos de la tarjeta.');
      tarjeta = { ...cardSchema.parse(card.getValues()), pais: 'EC' };
    }
    try {
      const reservation = await purchase.run({
        attraction_id: a.id,
        slot_id: slot.slotId,
        date,
        time: slot.time,
        adult_count: tickets.adult,
        child_count: tickets.child,
        senior_count: tickets.senior,
        infant_count: tickets.infant,
        ...(requirements.trim() ? { special_requirements: requirements.trim() } : {}),
        customer: values,
        payment_method: { method: method.codigo },
        ...(tarjeta ? { tarjeta } : {}),
        ...(coupon?.valid ? { coupon_code: coupon.code } : {}),
      });
      notify(
        reservation.status === 'CONFIRMED' ? '¡Compra confirmada! Te enviamos el voucher por correo.' : 'Reserva registrada. Tu pago está pendiente de confirmación.',
        'success',
      );
      navigate(paths.reservation(reservation.reservation_id), { replace: true });
    } catch (error) {
      if (isApiError(error, 'availability')) {
        setSlot(null);
        select({ slot: null });
        setAvailabilityKey((k) => k + 1);
      }
    }
  });

  const customerErrors = customer.formState.errors;
  const cardErrors = card.formState.errors;
  const serverError = (name: string) => fieldError(purchase.error, `customer.${name}`);

  return (
    <div className="page-container pt-4">
      <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: a.name, to: paths.attraction(a.id) }, { label: 'Comprar' }]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">Finaliza tu compra</h1>
        <p className="flex items-center gap-1.5 text-sm text-ink-soft">
          <Lock size={14} aria-hidden="true" /> Proceso seguro
        </p>
      </div>

      <form onSubmit={submit} noValidate className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Step n={1} title="Fecha, boletos y horario">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <p className="field-label">Fecha</p>
                <AvailabilityCalendar
                  value={date}
                  onChange={(d) => {
                    setDate(d);
                    setSlot(null);
                    select({ date: d, slot: null });
                  }}
                />
              </div>
              <div className="space-y-5">
                <TicketSelector
                  value={tickets}
                  price={a.price}
                  onChange={(t) => {
                    setTickets(t);
                    setCoupon(null);
                    select({ tickets: t });
                  }}
                />
                <div>
                  <p className="field-label">Horario</p>
                  <AvailabilitySelector
                    key={availabilityKey}
                    attractionId={a.id}
                    date={date}
                    quantity={quantity}
                    value={slot?.slotId ?? ''}
                    onChange={(s) => {
                      const next = { slotId: s.slot_id, time: slotTime(s) };
                      setSlot(next);
                      select({ slot: next });
                    }}
                  />
                </div>
              </div>
            </div>
          </Step>

          <Step n={2} title="Datos del titular">
            <p className="mb-4 text-sm text-ink-soft">Presentarás este documento en el punto de encuentro junto con el código QR.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Nombre completo"
                autoComplete="name"
                error={customerErrors.full_name?.message ?? serverError('full_name')}
                {...customer.register('full_name')}
              />
              <Input
                label="Correo electrónico"
                type="email"
                autoComplete="email"
                help="Aquí recibirás el voucher."
                error={customerErrors.email?.message ?? serverError('email')}
                {...customer.register('email')}
              />
              <Input
                label="Teléfono"
                type="tel"
                autoComplete="tel"
                placeholder="0991234567 o +593991234567"
                error={customerErrors.phone?.message ?? serverError('phone')}
                {...customer.register('phone')}
              />
              <div className="grid grid-cols-[140px_1fr] gap-3">
                <Select
                  label="Documento"
                  options={[
                    { value: 'CEDULA', label: 'Cédula' },
                    { value: 'PASAPORTE', label: 'Pasaporte' },
                    { value: 'RUC', label: 'RUC' },
                  ]}
                  {...customer.register('document_type')}
                />
                <Input label="Número" error={customerErrors.document_id?.message ?? serverError('document_id')} {...customer.register('document_id')} />
              </div>
              <TextArea
                label="Requerimientos especiales (opcional)"
                className="sm:col-span-2"
                maxLength={500}
                placeholder="Alergias, dieta, silla de ruedas…"
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
              />
            </div>
          </Step>

          <Step n={3} title="Pago">
            <PaymentMethodSelector methods={methods} value={method?.codigo ?? null} onChange={setMethod} />
            {method?.requiere_datos && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Select
                  label="Marca"
                  options={['VISA', 'MASTERCARD', 'AMEX', 'DINERS'].map((m) => ({ value: m, label: m }))}
                  {...card.register('marca')}
                />
                <Input label="Titular de la tarjeta" autoComplete="cc-name" error={cardErrors.titular?.message} {...card.register('titular')} />
                <Input
                  label="Últimos 4 dígitos"
                  inputMode="numeric"
                  maxLength={4}
                  help="Solo los 4 últimos: nunca el número completo."
                  error={cardErrors.ultimos4?.message}
                  {...card.register('ultimos4')}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Mes" inputMode="numeric" placeholder="MM" autoComplete="cc-exp-month" error={cardErrors.mes?.message} {...card.register('mes')} />
                  <Input label="Año" inputMode="numeric" placeholder="AAAA" autoComplete="cc-exp-year" error={cardErrors.anio?.message} {...card.register('anio')} />
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
              <Input
                className="flex-1"
                label="Cupón de descuento (opcional)"
                value={couponCode}
                onChange={(e) => {
                  setCouponCode(e.target.value);
                  setCoupon(null);
                  setCouponError('');
                }}
                error={couponError || undefined}
                help={coupon?.valid ? `Cupón ${coupon.code} aplicado.` : undefined}
              />
              <Button variant="secondary" onClick={applyCoupon} loading={checkingCoupon} disabled={!couponCode.trim()}>
                Aplicar
              </Button>
            </div>

            <label className="mt-6 flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-[18px] w-[18px] accent-[#C94D6B]" checked={acceptPolicy} onChange={(e) => setAcceptPolicy(e.target.checked)} />
              <span>
                {a.cancellation_policy?.free_cancellation
                  ? `Acepto la política de cancelación (gratuita hasta ${a.cancellation_policy.deadline_hours} horas antes) y los términos de uso.`
                  : 'Acepto que esta experiencia no admite cancelación gratuita y los términos de uso.'}
              </span>
            </label>
          </Step>

          {formError && <Alert tone="error">{formError}</Alert>}
          {!!purchase.error && <Alert tone="error">{errorMessage(purchase.error)}</Alert>}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <ShieldCheck size={18} className="text-success" aria-hidden="true" /> Orden, cupos y pago se confirman juntos: si algo falla, no se cobra.
            </p>
            <Button type="submit" size="lg" loading={purchase.pending}>
              Pagar y confirmar
            </Button>
          </div>
        </div>

        <div className="lg:sticky lg:top-36 lg:self-start">
          <CheckoutSummary attraction={a} date={date} time={slot?.time ?? ''} tickets={tickets} discount={coupon?.valid ? coupon.discount_amount : 0} />
        </div>
      </form>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="card-surface p-5 sm:p-6" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-5 flex items-center gap-3 text-lg">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-sm text-white" aria-hidden="true">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
