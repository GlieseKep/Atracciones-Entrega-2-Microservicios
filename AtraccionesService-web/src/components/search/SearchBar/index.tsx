import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, MapPin, Search } from 'lucide-react';
import { parseFilters, serializeFilters } from '@/features/attractions/filters';
import { today } from '@/utils/dates';
import { paths } from '@/utils/routes';

export const KNOWN_CITIES = ['Quito', 'Latacunga', 'Mindo', 'Baños de Agua Santa', 'Riobamba', 'San Antonio de Pichincha'];

interface SearchBarProps {
  /** `hero`: buscador grande del inicio (destino + fecha). `compact`: píldora de la cabecera. */
  variant?: 'hero' | 'compact';
}

/** Convierte el texto en filtro de ciudad cuando coincide con un destino conocido. */
function toQuery(text: string, date: string) {
  const value = text.trim();
  const city = KNOWN_CITIES.find((c) => c.toLowerCase() === value.toLowerCase());
  return serializeFilters({ q: city ? '' : value, city: city ?? '', date });
}

export function SearchBar({ variant = 'hero' }: SearchBarProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const current = parseFilters(params);
  const [text, setText] = useState(current.q || current.city);
  const [date, setDate] = useState<string>(current.date);
  const listId = useId();
  const textId = useId();
  const dateId = useId();

  useEffect(() => {
    setText(current.q || current.city);
    setDate(current.date);
  }, [current.q, current.city, current.date]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(paths.attractions(toQuery(text, date)));
  };

  const datalist = (
    <datalist id={listId}>
      {KNOWN_CITIES.map((c) => (
        <option key={c} value={c} />
      ))}
    </datalist>
  );

  if (variant === 'compact') {
    return (
      <form role="search" onSubmit={submit} className="relative mx-auto w-full max-w-xl">
        <label htmlFor={textId} className="sr-only">
          Buscar lugares y cosas que hacer
        </label>
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input
          id={textId}
          type="search"
          list={listId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Buscar lugares y cosas que hacer"
          className="h-11 w-full rounded-full border border-line bg-white pl-11 pr-24 text-sm shadow-sm placeholder:text-ink-muted hover:shadow-card focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {datalist}
        <button type="submit" className="absolute right-1 top-1 h-9 rounded-full bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
          Buscar
        </button>
      </form>
    );
  }

  return (
    <form
      role="search"
      onSubmit={submit}
      className="flex w-full max-w-3xl flex-col gap-2 rounded-lg bg-white p-2 shadow-raised md:flex-row md:items-center md:gap-0 md:rounded-full"
    >
      <div className="flex flex-1 items-center gap-3 rounded-full px-4 py-2 md:border-r md:border-line">
        <MapPin size={20} className="shrink-0 text-brand-500" aria-hidden="true" />
        <div className="flex-1">
          <label htmlFor={textId} className="block text-xs font-bold text-ink">
            ¿Adónde vas?
          </label>
          <input
            id={textId}
            type="search"
            list={listId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ciudad, atracción o experiencia"
            className="w-full bg-transparent text-[15px] placeholder:text-ink-muted focus:outline-none"
          />
          {datalist}
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-full px-4 py-2 md:w-56">
        <CalendarDays size={20} className="shrink-0 text-brand-500" aria-hidden="true" />
        <div className="flex-1">
          <label htmlFor={dateId} className="block text-xs font-bold text-ink">
            ¿Cuándo?
          </label>
          <input
            id={dateId}
            type="date"
            min={today()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-transparent text-[15px] text-ink focus:outline-none"
          />
        </div>
      </div>
      <button
        type="submit"
        className="flex h-12 items-center justify-center gap-2 rounded-full bg-brand-500 px-7 font-semibold text-white hover:bg-brand-600"
      >
        <Search size={18} aria-hidden="true" /> Buscar
      </button>
    </form>
  );
}
