import { useState } from 'react';
import { Button } from '@/components/common/Button';
import { AvailabilityCalendar } from '@/components/reservation/AvailabilityCalendar';
import { AvailabilitySelector } from '@/components/reservation/AvailabilitySelector';
import { QuantityStepper } from '@/components/reservation/QuantityStepper';
import type { PurchaseSelection } from '@/stores/purchaseStore';
import { isNotPast, isValidLocalTime } from '@/utils/dates';

interface Props {
  attractionId: string;
  initial: Partial<PurchaseSelection>;
  onChange: (selection: Partial<PurchaseSelection>) => void;
  onContinue: (selection: PurchaseSelection) => void;
}

/** Paso 1 de la compra directa: fecha, horario y cantidad, validados contra la disponibilidad del servidor. */
export function PurchaseForm({ attractionId, initial, onChange, onContinue }: Props) {
  const [date, setDate] = useState(initial.date ?? '');
  const [time, setTime] = useState(initial.time ?? '');
  const [quantity, setQuantity] = useState(initial.quantity ?? 1);
  const valid = isNotPast(date) && isValidLocalTime(time) && quantity >= 1 && quantity <= 100;

  const update = (patch: Partial<PurchaseSelection>) => onChange({ date, time, quantity, ...patch });

  return (
    <div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <p className="field-label">Fecha</p>
          <AvailabilityCalendar
            value={date}
            onChange={(d) => {
              setDate(d);
              setTime('');
              update({ date: d, time: '' });
            }}
          />
        </div>
        <div className="space-y-5">
          <QuantityStepper
            value={quantity}
            onChange={(n) => {
              setQuantity(n);
              update({ quantity: n });
            }}
          />
          <div>
            <p className="field-label">Horario</p>
            <AvailabilitySelector
              attractionId={attractionId}
              date={date}
              quantity={quantity}
              value={time}
              onChange={(t) => {
                setTime(t);
                update({ time: t });
              }}
            />
          </div>
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <Button size="lg" disabled={!valid} onClick={() => onContinue({ attractionId, date, time, quantity })}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
