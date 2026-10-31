import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import type { Attraction } from '@/types/attraction';
import { errorMessage } from '@/utils/api';
import { reservationFormSchema, type ReservationFormValues } from '@/utils/validation';
import { AvailabilityCalendar } from '../AvailabilityCalendar';
import { AvailabilitySelector } from '../AvailabilitySelector';
import { QuantityStepper } from '../QuantityStepper';

interface Props {
  attraction: Attraction;
  defaults: Partial<ReservationFormValues>;
  submitting: boolean;
  error: unknown;
  onSubmit: (values: ReservationFormValues) => void;
  onChangeSelection?: (values: Partial<ReservationFormValues>) => void;
}

/** Formulario de reserva por pasos visuales: actividad → datos del titular → política y confirmación. */
export function ReservationForm({ attraction, defaults, submitting, error, onSubmit, onChangeSelection }: Props) {
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ReservationFormValues>({
    resolver: zodResolver(reservationFormSchema),
    mode: 'onTouched',
    defaultValues: { ticketCount: 1, time: '', date: '', customerName: '', customerEmail: '', ...defaults, acceptPolicy: undefined },
  });

  const date = watch('date');
  const ticketCount = watch('ticketCount');
  const time = watch('time');

  const select = (patch: Partial<ReservationFormValues>) => onChangeSelection?.({ date, time, ticketCount, ...patch });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-8">
      <Step n={1} title="Detalles de la actividad">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="field-label">Fecha</p>
            <Controller
              control={control}
              name="date"
              render={({ field }) => (
                <AvailabilityCalendar
                  value={field.value}
                  onChange={(d) => {
                    field.onChange(d);
                    setValue('time', '');
                    select({ date: d, time: '' });
                  }}
                />
              )}
            />
            {errors.date && <p className="field-error">{errors.date.message}</p>}
          </div>
          <div className="space-y-5">
            <Controller
              control={control}
              name="ticketCount"
              render={({ field }) => (
                <QuantityStepper
                  value={Number(field.value) || 1}
                  onChange={(n) => {
                    field.onChange(n);
                    select({ ticketCount: n });
                  }}
                />
              )}
            />
            <div>
              <p className="field-label">Horario</p>
              <Controller
                control={control}
                name="time"
                render={({ field }) => (
                  <AvailabilitySelector
                    attractionId={attraction.id}
                    date={date}
                    quantity={Number(ticketCount) || 1}
                    value={field.value}
                    onChange={(t) => {
                      field.onChange(t);
                      select({ time: t });
                    }}
                  />
                )}
              />
              {errors.time && <p className="field-error">{errors.time.message}</p>}
              {errors.ticketCount && <p className="field-error">{errors.ticketCount.message}</p>}
            </div>
          </div>
        </div>
      </Step>

      <Step n={2} title="Datos del titular">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nombre completo" autoComplete="name" error={errors.customerName?.message} {...register('customerName')} />
          <Input
            label="Correo electrónico"
            type="email"
            autoComplete="email"
            help="Te enviaremos aquí la confirmación."
            error={errors.customerEmail?.message}
            {...register('customerEmail')}
          />
        </div>
      </Step>

      <Step n={3} title="Política de cancelación">
        <p className="text-ink-soft">
          {attraction.freeCancellation
            ? 'Cancelación gratuita: puedes cancelar sin coste antes de que comience la actividad desde “Mis reservas”.'
            : 'Esta actividad no admite cancelación gratuita. Las cancelaciones están sujetas a las condiciones del operador.'}
        </p>
        <label className="mt-4 flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-[18px] w-[18px] accent-[#C94D6B]" {...register('acceptPolicy')} aria-invalid={errors.acceptPolicy ? true : undefined} />
          <span>He leído y acepto la política de cancelación y los términos de uso.</span>
        </label>
        {errors.acceptPolicy && <p className="field-error">{errors.acceptPolicy.message}</p>}
      </Step>

      {!!error && <Alert tone="error">{errorMessage(error)}</Alert>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <ShieldCheck size={18} className="text-success" aria-hidden="true" /> Reserva segura con disponibilidad confirmada al momento.
        </p>
        <Button type="submit" size="lg" loading={submitting}>
          Confirmar reserva
        </Button>
      </div>
    </form>
  );
}

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
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
