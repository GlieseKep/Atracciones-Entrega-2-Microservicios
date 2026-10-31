import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import type { PurchaseResponse } from '@/types/purchase';
import { formatDate } from '@/utils/dates';
import { formatMoney, shortCode } from '@/utils/formatters';

/** Resumen del pedido devuelto por el servidor, con la cuenta atrás de la retención de cupos. */
export function PurchaseSummary({ purchase }: { purchase: PurchaseResponse }) {
  return (
    <div className="rounded-md bg-surface p-4 text-sm">
      <dl className="grid grid-cols-2 gap-y-2">
        <dt className="text-ink-soft">Pedido</dt>
        <dd className="text-right font-mono font-semibold">#{shortCode(purchase.orderId)}</dd>
        <dt className="text-ink-soft">Fecha y hora</dt>
        <dd className="text-right">
          {formatDate(purchase.date)} · {purchase.time}
        </dd>
        <dt className="text-ink-soft">Precio unitario</dt>
        <dd className="text-right">{formatMoney(purchase.unitPrice.total, purchase.unitPrice.currency)}</dd>
        <dt className="text-ink-soft">Cantidad</dt>
        <dd className="text-right">{purchase.quantity}</dd>
        <dt className="font-bold">Total a pagar</dt>
        <dd className="text-right text-lg font-extrabold">{formatMoney(purchase.totalAmount, purchase.currency)}</dd>
      </dl>
      {purchase.holdExpiresAt && <HoldCountdown until={purchase.holdExpiresAt} />}
    </div>
  );
}

export function HoldCountdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = Math.max(0, new Date(until).getTime() - now);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return (
    <p className={`mt-3 flex items-center gap-2 font-semibold ${remaining ? 'text-ink' : 'text-danger'}`} role="timer">
      <Timer size={16} aria-hidden="true" />
      {remaining
        ? `Tus plazas están reservadas durante ${minutes}:${String(seconds).padStart(2, '0')} min`
        : 'La reserva temporal de plazas expiró.'}
    </p>
  );
}
