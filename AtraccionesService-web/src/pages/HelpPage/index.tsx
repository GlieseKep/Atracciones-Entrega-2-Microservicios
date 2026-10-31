import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Faq } from '@/components/ui/Faq';
import { FAQ } from '@/features/content/homeContent';

const SECTIONS = [
  {
    id: 'cancelacion',
    title: 'Política de cancelación',
    text: 'Las experiencias marcadas con “Cancelación gratuita” pueden cancelarse sin coste antes de su inicio desde Mis reservas. Las reservas que pertenecen a un pedido se cancelan desde el detalle del pedido. Las demás experiencias siguen las condiciones del operador.',
  },
  {
    id: 'pagos',
    title: 'Pagos y facturación',
    text: 'Los pagos de esta plataforma son simulados con fines académicos: nunca solicitamos números de tarjeta ni credenciales bancarias. El importe lo calcula siempre el servidor y la factura usa los datos de facturación de tu perfil.',
  },
  {
    id: 'terminos',
    title: 'Términos de uso',
    text: 'Al reservar aceptas proporcionar datos veraces del titular y respetar las indicaciones del operador de cada experiencia.',
  },
  {
    id: 'privacidad',
    title: 'Privacidad y cookies',
    text: 'Tu contraseña se guarda cifrada (scrypt) y nunca se comparte. Tu sesión se mantiene solo en memoria: al recargar o cerrar la pestaña tendrás que volver a iniciar sesión. En este navegador guardamos únicamente tus pedidos recientes y preferencias de vista.',
  },
  {
    id: 'nosotros',
    title: 'Quiénes somos',
    text: 'TourGirls es un proyecto académico de Integración de Sistemas que conecta viajeros con experiencias fotogénicas de Ecuador.',
  },
  { id: 'contacto', title: 'Contacto', text: 'Escríbenos a hola@tourgirls.example o llámanos al +593 2 000 0000.' },
];

export default function HelpPage() {
  return (
    <div className="page-container max-w-3xl pt-4">
      <Breadcrumbs items={[{ label: 'Inicio', to: '/' }, { label: 'Centro de ayuda' }]} />
      <h1 className="mt-4 text-3xl">Centro de ayuda</h1>
      <div className="mt-8 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-32">
            <h2 className="text-xl">{s.title}</h2>
            <p className="mt-2 text-ink-soft">{s.text}</p>
          </section>
        ))}
        <section>
          <h2 className="mb-4 text-xl">Preguntas frecuentes</h2>
          <Faq items={FAQ} />
        </section>
      </div>
    </div>
  );
}
