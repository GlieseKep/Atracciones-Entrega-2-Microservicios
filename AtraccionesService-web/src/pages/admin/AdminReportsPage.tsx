import { useState } from 'react';
import { adminApi, type SalesReport } from '@/api/admin';
import { EmptyState, ErrorState } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { useAsync } from '@/hooks/useAsync';
import { addDays, formatDate, today } from '@/utils/dates';
import { formatMoney } from '@/utils/formatters';

/** Ventas cobradas por atracción y por día, y reservas confirmadas, en un rango (por defecto, los últimos 30 días). */
export default function AdminReportsPage() {
  const [toDate, setToDate] = useState(today());
  const [fromDate, setFromDate] = useState(addDays(today(), -29));
  const valid = fromDate !== '' && toDate !== '' && fromDate <= toDate;
  const report = useAsync((signal) => adminApi.salesReport(fromDate, toDate, signal), [fromDate, toDate], valid);

  return (
    <div>
      <h1 className="text-3xl">Reportes</h1>
      <div className="mt-6 grid max-w-xl gap-3 sm:grid-cols-2">
        <Input label="Desde" type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} />
        <Input label="Hasta" type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} />
      </div>
      <div className="mt-6">
        {!valid ? (
          <EmptyState title="Rango no válido">La fecha inicial debe ser anterior o igual a la final.</EmptyState>
        ) : report.status === 'error' ? (
          <ErrorState error={report.error} onRetry={report.retry} />
        ) : !report.data ? (
          <div className="skeleton h-72" aria-busy="true" />
        ) : (
          <ReportView report={report.data} />
        )}
      </div>
    </div>
  );
}

function ReportView({ report }: { report: SalesReport }) {
  const money = (n: number) => formatMoney(n, report.currency);
  const revenue = report.byDay.reduce((s, d) => s + d.revenue, 0);
  const orders = report.byDay.reduce((s, d) => s + d.orders, 0);
  const tickets = report.byDay.reduce((s, d) => s + d.tickets, 0);
  const maxDay = Math.max(1, ...report.byDay.map((d) => d.revenue));
  const maxAttraction = Math.max(1, ...report.byAttraction.map((a) => a.revenue));

  const stats = [
    { label: 'Ingresos', value: money(revenue) },
    { label: 'Pedidos cobrados', value: orders.toLocaleString('es-EC') },
    { label: 'Entradas vendidas', value: tickets.toLocaleString('es-EC') },
    { label: 'Ticket medio', value: orders ? money(revenue / orders) : '—' },
  ];

  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card-surface p-5">
            <dt className="text-sm text-ink-soft">{s.label}</dt>
            <dd className="mt-1 text-2xl font-extrabold">{s.value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-10">
        <h2 className="text-xl">Ingresos por día</h2>
        {report.byDay.length === 0 ? (
          <p className="mt-2 text-ink-soft">No hubo ventas cobradas en este rango.</p>
        ) : (
          <ul className="mt-4 space-y-1.5">
            {report.byDay.map((d) => (
              <li key={d.date} className="grid grid-cols-[110px_1fr_110px] items-center gap-3 text-sm">
                <span className="text-ink-soft">{formatDate(d.date)}</span>
                <span className="h-3 rounded-full bg-surface" aria-hidden="true">
                  <span className="block h-3 rounded-full bg-brand-500" style={{ width: `${(d.revenue / maxDay) * 100}%` }} />
                </span>
                <span className="text-right font-semibold">
                  {money(d.revenue)}
                  <span className="block text-xs font-normal text-ink-muted">{d.orders} pedidos</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-xl">Ventas por atracción</h2>
        {report.byAttraction.length === 0 ? (
          <p className="mt-2 text-ink-soft">Sin ventas en este rango.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th scope="col" className="px-4 py-3">Atracción</th>
                  <th scope="col" className="px-4 py-3 text-right">Pedidos</th>
                  <th scope="col" className="px-4 py-3 text-right">Entradas</th>
                  <th scope="col" className="px-4 py-3">Ingresos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.byAttraction.map((a) => (
                  <tr key={a.attractionId}>
                    <td className="px-4 py-3 font-semibold">{a.attractionName}</td>
                    <td className="px-4 py-3 text-right">{a.orders}</td>
                    <td className="px-4 py-3 text-right">{a.tickets}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-2 flex-1 rounded-full bg-surface" aria-hidden="true">
                          <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(a.revenue / maxAttraction) * 100}%` }} />
                        </span>
                        <span className="w-24 text-right font-semibold">{money(a.revenue)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-xl">Reservas confirmadas por atracción</h2>
        <p className="text-sm text-ink-soft">Por fecha de visita dentro del rango, incluidas las que vienen de una compra.</p>
        {report.reservationsByAttraction.length === 0 ? (
          <p className="mt-2 text-ink-soft">Sin reservas confirmadas en este rango.</p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {report.reservationsByAttraction.map((r) => (
              <li key={r.attractionId} className="card-surface flex items-center justify-between gap-3 p-4">
                <span className="font-semibold">{r.attractionName}</span>
                <span className="text-right text-sm">
                  {r.reservations} reservas
                  <span className="block text-xs text-ink-muted">{r.tickets} entradas</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
