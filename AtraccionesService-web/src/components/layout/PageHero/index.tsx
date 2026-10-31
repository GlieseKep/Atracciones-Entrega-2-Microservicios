import type { ReactNode } from 'react';

interface PageHeroProps {
  image: string;
  imageAlt: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

/** Banner de destino: foto panorámica con overlay oscuro y buscador superpuesto. */
export function PageHero({ image, imageAlt, eyebrow, title, subtitle, children }: PageHeroProps) {
  return (
    <section className="page-container pt-4">
      <div className="relative isolate overflow-hidden rounded-lg">
        <img
          src={image}
          alt={imageAlt}
          className="absolute inset-0 -z-10 h-full w-full object-cover"
          fetchPriority="high"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-night/80 via-night/40 to-night/10" aria-hidden="true" />
        <div className="flex min-h-[420px] flex-col justify-end px-5 pb-8 pt-24 sm:px-10 sm:pb-10 md:min-h-[480px]">
          {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-brand-100">{eyebrow}</p>}
          <h1 className="mt-2 max-w-3xl text-4xl font-extrabold text-white sm:text-5xl">{title}</h1>
          {subtitle && <p className="mt-3 max-w-2xl text-lg text-white/90">{subtitle}</p>}
          {children && <div className="mt-6">{children}</div>}
        </div>
      </div>
    </section>
  );
}
