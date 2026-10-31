import { ChevronDown } from 'lucide-react';

/** Acordeón de preguntas frecuentes con <details> (accesible sin JS). */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <details key={item.q} className="group py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
            {item.q}
            <ChevronDown size={20} className="shrink-0 transition group-open:rotate-180" aria-hidden="true" />
          </summary>
          <p className="pb-4 text-ink-soft">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
