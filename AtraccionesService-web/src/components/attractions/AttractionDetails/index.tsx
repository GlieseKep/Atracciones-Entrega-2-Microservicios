import type { ReactNode } from 'react';
import { Accessibility, Building2, Bus, CalendarX2, Check, Clock, Languages, Phone, User, Utensils, X } from 'lucide-react';
import type { AttractionDetail } from '@/types/attraction';
import { AttractionMap } from '../AttractionMap';

/** Secciones de la ficha (`AtraccionDetailResponseV2`): resumen, incluye, itinerario, encuentro, accesibilidad, cancelación. */
export function AttractionDetails({ attraction: a }: { attraction: AttractionDetail }) {
  const highlights = [
    a.duration && { icon: Clock, label: a.duration },
    a.inclusions.includes_guide && { icon: User, label: 'Guía certificado' },
    a.inclusions.includes_transport && { icon: Bus, label: 'Transporte incluido' },
    a.inclusions.includes_food && { icon: Utensils, label: 'Alimentación incluida' },
    a.guide_languages?.length && { icon: Languages, label: `Guía en ${a.guide_languages.join(', ')}` },
  ].filter(Boolean) as { icon: typeof Clock; label: string }[];

  const access = a.accessibility;
  const accessItems = [
    [access?.wheelchair_accessible, 'Apto para silla de ruedas'],
    [access?.stroller_accessible, 'Apto para coches de bebé'],
    [access?.service_animals_allowed, 'Admite animales de asistencia'],
  ] as const;
  const policy = a.cancellation_policy;

  return (
    <div className="divide-y divide-line">
      <Section title="Descripción general" first>
        <p className="whitespace-pre-line text-[16px] leading-7 text-ink">{a.description}</p>
        {highlights.length > 0 && (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {highlights.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5">
                <Icon size={20} className="text-ink-soft" aria-hidden="true" /> {label}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!!(a.inclusions_list?.length || a.exclusions_list?.length) && (
        <Section title="Qué incluye">
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {a.inclusions_list?.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" /> {item}
              </li>
            ))}
            {a.exclusions_list?.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-ink-soft">
                <X size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" /> {item}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {a.itinerary.length > 0 && (
        <Section title="Itinerario">
          <ol className="space-y-5 border-l-2 border-line pl-5">
            {[...a.itinerary]
              .sort((x, y) => x.stop_number - y.stop_number)
              .map((stop) => (
                <li key={stop.stop_number} className="relative">
                  <span className="absolute -left-[31px] top-0 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-white">
                    {stop.stop_number}
                  </span>
                  <p className="font-semibold">
                    {stop.time} · {stop.title}
                  </p>
                  {stop.description && <p className="mt-0.5 text-sm text-ink-soft">{stop.description}</p>}
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {stop.duration_minutes} min{stop.location_name ? ` · ${stop.location_name}` : ''}
                  </p>
                </li>
              ))}
          </ol>
        </Section>
      )}

      <Section title="Punto de encuentro">
        <AttractionMap point={a.meeting_point_geo} />
      </Section>

      {accessItems.some(([value]) => value !== undefined) && (
        <Section title="Accesibilidad">
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {accessItems.map(([value, label]) => (
              <li key={label} className={`flex items-center gap-2.5 ${value ? '' : 'text-ink-soft'}`}>
                {value ? (
                  <Accessibility size={18} className="text-success" aria-hidden="true" />
                ) : (
                  <X size={18} className="text-danger" aria-hidden="true" />
                )}
                {value ? label : `No ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {a.proveedor?.nombre_comercial && (
        <Section title="Operador">
          <p className="flex items-center gap-2 text-ink-soft">
            <Building2 size={16} aria-hidden="true" /> <span className="font-semibold text-ink">{a.proveedor.nombre_comercial}</span>
            {a.proveedor.ruc && <span className="text-sm">· RUC {a.proveedor.ruc}</span>}
          </p>
          {a.proveedor.telefono_emergencia && (
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
              <Phone size={16} aria-hidden="true" /> Emergencias: {a.proveedor.telefono_emergencia}
            </p>
          )}
        </Section>
      )}

      <Section title="Política de cancelación" id="cancelacion">
        <p className="flex items-start gap-2.5">
          <CalendarX2 size={20} className={`mt-0.5 shrink-0 ${policy?.free_cancellation ? 'text-success' : 'text-danger'}`} aria-hidden="true" />
          <span>
            {policy?.free_cancellation
              ? `Cancela gratis hasta ${policy.deadline_hours} horas antes del inicio para recibir el reembolso completo.`
              : 'Esta experiencia no admite cancelación gratuita.'}
            {policy?.description && <span className="mt-1 block text-sm text-ink-soft">{policy.description}</span>}
          </span>
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
