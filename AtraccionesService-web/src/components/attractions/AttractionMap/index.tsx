import { ExternalLink, MapPin } from 'lucide-react';
import type { Location } from '@/types/attraction';

/** Punto de encuentro sobre OpenStreetMap (sin claves de API). */
export function AttractionMap({ location }: { location: Location }) {
  const c = location.coordinates;
  return (
    <div>
      <p className="flex items-start gap-2">
        <MapPin size={18} className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
        <span>
          <span className="font-semibold">{location.address}</span>
          <br />
          <span className="text-ink-soft">
            {location.city}, {location.country === 'EC' ? 'Ecuador' : location.country}
          </span>
        </span>
      </p>
      {c && (
        <>
          <iframe
            title={`Mapa del punto de encuentro: ${location.address}`}
            className="mt-4 h-64 w-full rounded-md border border-line"
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${c.longitude - 0.01}%2C${c.latitude - 0.007}%2C${c.longitude + 0.01}%2C${c.latitude + 0.007}&layer=mapnik&marker=${c.latitude}%2C${c.longitude}`}
          />
          <a
            href={`https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=15/${c.latitude}/${c.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="link mt-2 inline-flex items-center gap-1 text-sm"
          >
            Abrir en el mapa <ExternalLink size={14} aria-hidden="true" />
          </a>
        </>
      )}
    </div>
  );
}
