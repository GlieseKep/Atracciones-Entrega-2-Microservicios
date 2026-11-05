import { Link } from 'react-router-dom';
import { photoAt } from '@/features/content/photos';

interface Props {
  name: string;
  /** Imagen de la ciudad (ms-location) o, si no tiene, de una de sus experiencias. */
  image?: string;
  to: string;
  caption?: string;
}

/** Tile de destino: foto cuadrada con el nombre debajo. */
export function DestinationChip({ name, image, to, caption }: Props) {
  return (
    <Link to={to} className="group block w-[160px] shrink-0 sm:w-auto">
      <div className="aspect-square overflow-hidden rounded-md">
        {image ? (
          <img
            src={photoAt(image, 330)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-brand-100 to-brand-300/60" />
        )}
      </div>
      <p className="mt-2 font-bold leading-snug group-hover:underline">{name}</p>
      {caption && <p className="text-sm text-ink-muted">{caption}</p>}
    </Link>
  );
}
