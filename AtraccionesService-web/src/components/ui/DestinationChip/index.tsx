import { Link } from 'react-router-dom';
import { photoAt } from '@/components/attractions/AttractionCard';

interface Props {
  name: string;
  image: string;
  to: string;
  caption?: string;
}

/** Tile de destino / atracción principal: foto cuadrada con el nombre debajo (estilo "Principales atracciones"). */
export function DestinationChip({ name, image, to, caption }: Props) {
  return (
    <Link to={to} className="group block w-[160px] shrink-0 sm:w-auto">
      <div className="aspect-square overflow-hidden rounded-md">
        <img
          src={photoAt(image, 330)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      </div>
      <p className="mt-2 font-bold leading-snug group-hover:underline">{name}</p>
      {caption && <p className="text-sm text-ink-muted">{caption}</p>}
    </Link>
  );
}
