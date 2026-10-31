import { CreditCard, Landmark } from 'lucide-react';
import type { PaymentMethod } from '@/types/payment';

const METHODS: { value: PaymentMethod; title: string; description: string; icon: typeof CreditCard }[] = [
  { value: 'CARD', title: 'Tarjeta (simulada)', description: 'Autorización inmediata en la pasarela de pruebas.', icon: CreditCard },
  { value: 'BANK_TRANSFER', title: 'Transferencia bancaria (simulada)', description: 'Liquidación simulada de la transferencia.', icon: Landmark },
];

/** Selector de método de pago simulado. Nunca pide número de tarjeta ni credenciales bancarias. */
export function PaymentMethodSelector({ value, onChange }: { value: PaymentMethod | null; onChange: (m: PaymentMethod) => void }) {
  return (
    <fieldset>
      <legend className="sr-only">Método de pago</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {METHODS.map(({ value: m, title, description, icon: Icon }) => (
          <label
            key={m}
            className={`flex cursor-pointer gap-3 rounded-md border p-4 transition ${
              value === m ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-line hover:border-ink'
            }`}
          >
            <input type="radio" name="payment-method" value={m} checked={value === m} onChange={() => onChange(m)} className="mt-1 accent-[#C94D6B]" />
            <span>
              <span className="flex items-center gap-2 font-bold">
                <Icon size={18} aria-hidden="true" /> {title}
              </span>
              <span className="mt-1 block text-sm text-ink-soft">{description}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Entorno de pagos simulados: no introduzcas datos reales de tarjeta. El resultado lo decide el servidor.
      </p>
    </fieldset>
  );
}
