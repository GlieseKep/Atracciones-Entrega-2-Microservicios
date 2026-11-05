import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Send } from 'lucide-react';
import { sendContactMessage } from '@/api/support';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input, TextArea } from '@/components/common/Input';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Faq } from '@/components/ui/Faq';
import { FAQ } from '@/features/content/faq';
import { useAuthStore } from '@/stores/authStore';
import { errorMessage, fieldError } from '@/utils/api';
import { contactSchema, type ContactValues } from '@/utils/validation';

const SECTIONS = [
  {
    id: 'cancelacion',
    title: 'Política de cancelación',
    text: 'Cada experiencia indica en su ficha si admite cancelación gratuita y hasta cuántas horas antes. Dentro de ese plazo puedes cancelar desde el detalle de la reserva: los cupos se liberan y el pago se reembolsa en el mismo método. Fuera del plazo, escríbenos con el formulario de contacto.',
  },
  {
    id: 'pagos',
    title: 'Pagos y facturación',
    text: 'El pago se procesa en el mismo paso de la compra, junto con la orden y los cupos. Nunca pedimos el número completo de tu tarjeta ni su código de seguridad. La factura electrónica se emite con el perfil de facturación principal de tu cuenta; sin perfil, a consumidor final.',
  },
  {
    id: 'terminos',
    title: 'Términos de uso',
    text: 'Al comprar aceptas proporcionar datos veraces del titular, presentar su documento en el punto de encuentro y respetar las indicaciones del operador de cada experiencia.',
  },
  {
    id: 'privacidad',
    title: 'Privacidad y cookies',
    text: 'Tu contraseña se guarda cifrada y nunca se comparte. Tu sesión se mantiene solo en memoria: al recargar o cerrar la pestaña tendrás que volver a iniciar sesión. En este navegador solo guardamos preferencias de vista.',
  },
  {
    id: 'nosotros',
    title: 'Quiénes somos',
    text: 'TourGirls es un proyecto académico de Integración de Sistemas que conecta viajeros con experiencias de operadores de Ecuador.',
  },
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
        <section id="contacto" className="scroll-mt-32">
          <h2 className="text-xl">Contacto</h2>
          <p className="mt-2 text-ink-soft">Escríbenos y el equipo de soporte te responderá por correo.</p>
          <ContactForm />
        </section>
      </div>
    </div>
  );
}

/** Mensaje para soporte (ms-support). No requiere sesión; con sesión se completan nombre y correo. */
function ContactForm() {
  const user = useAuthStore((s) => s.user);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    mode: 'onTouched',
    defaultValues: { nombre: user ? `${user.nombre} ${user.apellido}` : '', correo: user?.correo ?? '', asunto: '', cuerpo: '' },
  });

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await sendContactMessage(values);
      reset({ ...values, asunto: '', cuerpo: '' });
      setSent(true);
    } catch (e) {
      setError(e);
    }
  });

  const err = (name: keyof ContactValues) => errors[name]?.message ?? fieldError(error, name);

  return (
    <form onSubmit={submit} noValidate className="card-surface mt-4 grid gap-4 p-5 sm:grid-cols-2">
      <Input label="Nombre" autoComplete="name" error={err('nombre')} {...register('nombre')} />
      <Input label="Correo" type="email" autoComplete="email" error={err('correo')} {...register('correo')} />
      <Input label="Asunto" maxLength={30} className="sm:col-span-2" help="Máximo 30 caracteres." error={err('asunto')} {...register('asunto')} />
      <TextArea label="Mensaje" maxLength={2000} className="sm:col-span-2" error={err('cuerpo')} {...register('cuerpo')} />
      <div className="space-y-3 sm:col-span-2">
        {sent && <Alert tone="success">¡Mensaje enviado! Te responderemos al correo indicado.</Alert>}
        {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" loading={isSubmitting} onClick={() => setSent(false)}>
            <Send size={16} aria-hidden="true" /> Enviar mensaje
          </Button>
        </div>
      </div>
    </form>
  );
}
