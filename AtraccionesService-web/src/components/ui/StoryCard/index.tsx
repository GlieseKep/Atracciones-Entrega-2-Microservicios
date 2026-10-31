import { Link } from 'react-router-dom';
import { photoAt } from '@/components/attractions/AttractionCard';

interface Props {
  title: string;
  excerpt: string;
  image: string;
  to: string;
  tag: string;
}

/** Tarjeta editorial de "Ideas de viaje". */
export function StoryCard({ title, excerpt, image, to, tag }: Props) {
  return (
    <Link to={to} className="group block overflow-hidden rounded-md border border-line bg-white transition hover:shadow-raised">
      <div className="aspect-[16/9] overflow-hidden">
        <img src={photoAt(image, 960)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
      </div>
      <div className="p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-500">{tag}</p>
        <h3 className="mt-2 text-lg leading-snug group-hover:underline">{title}</h3>
        <p className="mt-2 line-clamp-3 text-sm text-ink-soft">{excerpt}</p>
      </div>
    </Link>
  );
}
