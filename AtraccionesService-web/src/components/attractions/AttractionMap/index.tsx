import { ExternalLink, MapPin } from 'lucide-react';
import type { MeetingPoint } from '@/types/attraction';

/** Punto de encuentro (`meeting_point_geo`) sobre OpenStreetMap (sin claves de API). */
export function AttractionMap({ point }: { point: MeetingPoint }) {
  const { latitude: lat, longitude: lon } = point;
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
  return (
    <div>
      <p className="flex items-start gap-2">
        <MapPin size={18} className="mt-0.5 shrink-0 text-brand-500" aria-hidden="true" />
        <span>
          <span className="font-semibold">{point.address}</span>
          <br />
          <span className="text-ink-soft">{point.city}, Ecuador</span>
        </span>
      </p>
      {point.arrival_instructions && <p className="mt-3 text-sm text-ink-soft">{point.arrival_instructions}</p>}
      {hasCoordinates && (
        <>
          <iframe
            title={`Mapa del punto de encuentro: ${point.address}`}
            className="mt-4 h-64 w-full rounded-md border border-line"
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.01}%2C${lat - 0.007}%2C${lon + 0.01}%2C${lat + 0.007}&layer=mapnik&marker=${lat}%2C${lon}`}
          />
          <a
            href={point.google_maps_url || `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`}
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
