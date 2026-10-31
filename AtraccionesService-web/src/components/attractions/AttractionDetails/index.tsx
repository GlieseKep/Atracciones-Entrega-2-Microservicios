import type { ReactNode } from 'react';
import { Building2, CalendarX2, Check, Clock, Languages, Smartphone, Ticket, X } from 'lucide-react';
import type { Attraction } from '@/types/attraction';
import { formatDuration, formatLanguage, PRODUCT_TYPE_LABEL } from '@/utils/formatters';
import { AttractionMap } from '../AttractionMap';

/** Secciones de contenido del detalle, en el orden de Viator: resumen, incluye, qué esperar, encuentro, info adicional, cancelación. */
export function AttractionDetails({ attraction: a }: { attraction: Attraction }) {
  const highlights = [
    { icon: Clock, label: formatDuration(a.duration) },
    { icon: Ticket, label: PRODUCT_TYPE_LABEL[a.productType] },
    { icon: Smartphone, label: 'Entrada móvil' },
    a.supportedLanguages.length > 0 && {
      icon: Languages,
      label: `Ofrecido en: ${a.supportedLanguages.map(formatLanguage).join(', ')}`,
    },
  ].filter(Boolean) as { icon: typeof Clock; label: string }[];

  return (
    <div className="divide-y divide-line">
      <Section title="Descripción general" first>
        <p className="whitespace-pre-line text-[16px] leading-7 text-ink">{a.longDescription}</p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {highlights.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2.5">
              <Icon size={20} className="text-ink-soft" aria-hidden="true" /> {label}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Qué incluye">
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {a.includes.map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <Check size={18} className="text-success" aria-hidden="true" /> {item}
            </li>
          ))}
          {!a.includes.includes('Transporte') && (
            <li className="flex items-center gap-2.5 text-ink-soft">
              <X size={18} className="text-danger" aria-hidden="true" /> Transporte al punto de encuentro
            </li>
          )}
          <li className="flex items-center gap-2.5 text-ink-soft">
            <X size={18} className="text-danger" aria-hidden="true" /> Propinas
          </li>
        </ul>
        {a.categories.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {a.categories.map((c) => (
              <span key={c} className="rounded-full bg-surface px-3 py-1 text-sm font-semibold">
                {c}
              </span>
            ))}
          </div>
        )}
      </Section>

      {a.locations[0] && (
        <Section title="Punto de encuentro">
          <AttractionMap location={a.locations[0]} />
        </Section>
      )}

      <Section title="Información adicional">
        <ul className="list-disc space-y-1.5 pl-5 text-ink-soft">
          <li>Recibirás la confirmación en el momento de la reserva.</li>
          <li>Lleva ropa abrigada: en los Andes la temperatura cambia rápidamente.</li>
          <li>Se recomienda un nivel de forma física moderado para actividades en altura.</li>
          <li>Máximo 100 viajeros por reserva.</li>
        </ul>
        {a.operator && (
          <p className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
            <Building2 size={16} aria-hidden="true" /> Operado por <span className="font-semibold text-ink">{a.operator.name}</span>
          </p>
        )}
      </Section>

      <Section title="Política de cancelación" id="cancelacion">
        <p className="flex items-start gap-2.5">
          <CalendarX2 size={20} className={`mt-0.5 shrink-0 ${a.freeCancellation ? 'text-success' : 'text-danger'}`} aria-hidden="true" />
          {a.freeCancellation
            ? 'Cancela gratis antes de que empiece la actividad para recibir un reembolso completo.'
            : 'Esta experiencia no es reembolsable. No se admiten cambios ni cancelaciones gratuitas.'}
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children, first, id }: { title: string; children: ReactNode; first?: boolean; id?: string }) {
  return (
    <section id={id} className={first ? 'pb-8' : 'py-8'}>
      <h2 className="mb-4 text-xl">{title}</h2>
      {children}
    </section>
  );
}
