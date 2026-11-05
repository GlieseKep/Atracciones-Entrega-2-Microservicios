import { CreditCard, Landmark, Wallet } from 'lucide-react';
import { ErrorState } from '@/components/common/Feedback';
import type { PaymentMethodCode } from '@/types/booking';
import type { PaymentMethodInfo } from '@/types/payment';
import type { AsyncState } from '@/hooks/useAsync';

const ICONS: Record<PaymentMethodCode, typeof CreditCard> = {
  CREDIT_CARD: CreditCard,
  DEBIT_CARD: CreditCard,
  PAYPAL: Wallet,
  TRANSFER: Landmark,
};

interface Props {
  methods: AsyncState<PaymentMethodInfo[]> & { retry: () => void };
  value: PaymentMethodCode | null;
  onChange: (method: PaymentMethodInfo) => void;
}

/** Métodos de pago de ms-payment. Nunca se pide el número completo de la tarjeta ni el código de seguridad. */
export function PaymentMethodSelector({ methods, value, onChange }: Props) {
  if (methods.status === 'loading') return <div className="skeleton h-24" aria-busy="true" />;
  if (methods.status === 'error') return <ErrorState error={methods.error} onRetry={methods.retry} className="py-6" />;

  return (
    <fieldset>
      <legend className="sr-only">Método de pago</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {methods.data.map((m) => {
          const Icon = ICONS[m.codigo] ?? CreditCard;
          return (
            <label
              key={m.codigo}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-4 transition ${
                value === m.codigo ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-line hover:border-ink'
              }`}
            >
              <input type="radio" name="payment-method" value={m.codigo} checked={value === m.codigo} onChange={() => onChange(m)} className="accent-[#C94D6B]" />
              <Icon size={18} aria-hidden="true" />
              <span className="font-bold">{m.nombre}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
