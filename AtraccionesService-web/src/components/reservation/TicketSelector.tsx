import type { TicketPrices } from '@/types/attraction';
import type { TicketCounts, TicketType } from '@/types/booking';
import { formatMoney, TICKET_TYPES } from '@/utils/formatters';
import { QuantityStepper } from './QuantityStepper';

/** Máximo de boletos por compra (todos los tipos). */
export const MAX_TICKETS = 20;

export const DEFAULT_TICKETS: TicketCounts = { adult: 1, child: 0, senior: 0, infant: 0 };

/** Boletos por tipo con su tarifa. Siempre hay al menos un adulto (lo exige Booking). */
export function TicketSelector({ value, onChange, price }: { value: TicketCounts; onChange: (value: TicketCounts) => void; price: TicketPrices }) {
  const total = value.adult + value.child + value.senior + value.infant;
  const set = (type: TicketType, n: number) => onChange({ ...value, [type]: n });
  return (
    <ul className="space-y-3">
      {TICKET_TYPES.map(({ type, label, help }) => (
        <li key={type}>
          <QuantityStepper
            label={
              <span>
                {label} <span className="block text-xs font-normal text-ink-muted">{help} · {price[type] > 0 ? formatMoney(price[type], price.currency) : 'Gratis'}</span>
              </span>
            }
            value={value[type]}
            min={type === 'adult' ? 1 : 0}
            max={value[type] + (MAX_TICKETS - total)}
            onChange={(n) => set(type, n)}
          />
        </li>
      ))}
    </ul>
  );
}
