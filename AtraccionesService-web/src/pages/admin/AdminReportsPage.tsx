import { useMemo, useState } from 'react';
import { collectPages, operationsApi } from '@/api/admin';
import { Alert, EmptyState, ErrorState } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { useAsync } from '@/hooks/useAsync';
import { addDays, formatDate, today } from '@/utils/dates';
import { formatMoney } from '@/utils/formatters';

const SOLD = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'];

/**
 * Reportes calculados en el panel, porque ningún servicio los agrega: ingresos por día con las facturas pagadas
 * (ms-invoicing) y ventas por experiencia con las reservas vigentes (ms-booking).
 */
export default function AdminReportsPage() {
  const [from, setFrom] = useState(addDays(today(), -30));
  const [to, setTo] = useState(today());
  const valid = !!from && !!to && from <= to;

  const data = useAsync(
    async (signal) => {
      const [invoices, reservations] = await Promise.all([
        collectPages((page) => operationsApi.invoices({ page, limit: 100, estado: 'PAGADA' }, signal)),
        collectPages((page) => operationsApi.reservations({ page, limit: 50 }, signal)),
      ]);
      return { invoices, reservations };
    },
    [],
  );

  const report = useMemo(() => {
    if (!data.data) return null;
    const byDay = new Map<string, { revenue: number; invoices: number }>();
    for (const invoice of data.data.invoices.items) {
      const day = invoice.emitida_en.slice(0, 10);
      if (day < from || day > to) continue;
      const entry = byDay.get(day) ?? { revenue: 0, invoices: 0 };
      entry.revenue += invoice.total;
      entry.invoices++;
      byDay.set(day, entry);
    }
    const byAttraction = new Map<string, { reservations: number; tickets: number; total: number }>();
    for (const r of data.data.reservations.items) {
      if (!SOLD.includes(r.status) || r.date < from || r.date > to) continue;
      const name = r.attraction_name || r.attraction_id || 'Sin nombre';
      const entry = byAttraction.get(name) ?? { reservations: 0, tickets: 0, total: 0 };
      entry.reservations++;
      entry.tickets += r.ticket_count;
      entry.total += r.total_price;
      byAttraction.set(name, entry);
    }
    return {
      days: [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)),
      attractions: [...byAttraction.entries()].sort(([, a], [, b]) => b.total - a.total),
      revenue: [...byDay.values()].reduce((sum, d) => sum + d.revenue, 0),
    };
  }, [data.data, from, to]);

  const maxDay = Math.max(1, ...(report?.days.map(([, d]) => d.revenue) ?? []));
  const truncated = data.data && (data.data.invoices.truncated || data.data.reservations.truncated);

  return (
    <div>
      <h1 className="text-3xl">Reportes</h1>
      <div className="mt-6 grid max-w-md grid-cols-2 gap-3">
        <Input label="Desde" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <Input label="Hasta" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
      </div>

      {data.status === 'error' ? (
        <ErrorState error={data.error} onRetry={data.retry} className="mt-6" />
      ) : !report ? (
        <div className="skeleton mt-6 h-72" aria-busy="true" />
      ) : !valid ? (
        <Alert tone="error" className="mt-6">«Desde» no puede ser posterior a «Hasta».</Alert>
      ) : (
        <>
          {truncated && <Alert className="mt-6">Hay más registros de los que el panel puede sumar: el reporte cubre solo los más recientes.</Alert>}
          <p className="mt-6 text-sm text-ink-soft">Ingresos facturados en el período</p>
          <p className="text-3xl font-extrabold">{formatMoney(report.revenue)}</p>

          <h2 className="mt-8 text-xl">Ingresos por día</h2>
          {report.days.length === 0 ? (
            <div className="mt-4"><EmptyState title="Sin facturas pagadas en el período" /></div>
          ) : (
            <ul className="mt-4 space-y-2">
              {report.days.map(([day, d]) => (
                <li key={day} className="grid grid-cols-[150px_1fr_110px] items-center gap-3 text-sm">
                  <span>{formatDate(day)}</span>
                  <span className="h-2 rounded-full bg-surface">
                    <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(d.revenue / maxDay) * 100}%` }} />
                  </span>
                  <span className="text-right font-semibold">{formatMoney(d.revenue)}</span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-8 text-xl">Ventas por experiencia</h2>
          <p className="text-xs text-ink-muted">Reservas vigentes con la actividad dentro del período.</p>
          {report.attractions.length === 0 ? (
            <div className="mt-4"><EmptyState title="Sin reservas en el período" /></div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-surface text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th scope="col" className="px-4 py-3">Experiencia</th>
                    <th scope="col" className="px-4 py-3 text-right">Reservas</th>
                    <th scope="col" className="px-4 py-3 text-right">Boletos</th>
                    <th scope="col" className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.attractions.map(([name, a]) => (
                    <tr key={name}>
                      <td className="px-4 py-3 font-semibold">{name}</td>
                      <td className="px-4 py-3 text-right">{a.reservations}</td>
                      <td className="px-4 py-3 text-right">{a.tickets}</td>
                      <td className="px-4 py-3 text-right">{formatMoney(a.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
