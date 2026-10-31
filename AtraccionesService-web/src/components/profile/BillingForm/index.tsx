import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import type { Customer, UpdateCustomerRequest } from '@/types/identity';
import { errorMessage } from '@/utils/api';
import { billingFormSchema, type BillingFormValues } from '@/utils/validation';

interface Props {
  customer?: Customer | null;
  fallbackEmail?: string;
  submitLabel?: string;
  submitting: boolean;
  error?: unknown;
  onSubmit: (body: UpdateCustomerRequest) => void;
  secondaryAction?: React.ReactNode;
}

/** Datos de facturación (PUT /customers/me). No se aceptan números de tarjeta como referencia de pago. */
export function BillingForm({ customer, fallbackEmail, submitLabel = 'Guardar', submitting, error, onSubmit, secondaryAction }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<BillingFormValues>({
    resolver: zodResolver(billingFormSchema),
    mode: 'onTouched',
    values: {
      billingName: customer?.billingName ?? '',
      billingEmail: customer?.billingEmail ?? fallbackEmail ?? '',
      billingAddress: customer?.billingAddress ?? '',
      taxId: customer?.taxId ?? '',
      paymentMethodReference: customer?.paymentMethodReference ?? '',
    },
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit((v) =>
        onSubmit({
          billingName: v.billingName,
          billingEmail: v.billingEmail,
          billingAddress: v.billingAddress,
          taxId: v.taxId || undefined,
          paymentMethodReference: v.paymentMethodReference || undefined,
        }),
      )}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nombre o razón social" autoComplete="name" error={errors.billingName?.message} {...register('billingName')} />
        <Input label="Correo de facturación" type="email" autoComplete="email" error={errors.billingEmail?.message} {...register('billingEmail')} />
        <Input
          label="Dirección de facturación"
          autoComplete="street-address"
          className="sm:col-span-2"
          error={errors.billingAddress?.message}
          {...register('billingAddress')}
        />
        <Input label="Cédula / RUC (opcional)" error={errors.taxId?.message} {...register('taxId')} />
        <Input
          label="Referencia de pago simulado (opcional)"
          help="Un alias como “mi-tarjeta”, nunca un número de tarjeta."
          error={errors.paymentMethodReference?.message}
          {...register('paymentMethodReference')}
        />
      </div>
      {!!error && <Alert tone="error">{errorMessage(error)}</Alert>}
      <div className="flex flex-wrap justify-end gap-3">
        {secondaryAction}
        <Button type="submit" loading={submitting} disabled={!isDirty && !!customer?.billingName && submitLabel === 'Guardar'}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
