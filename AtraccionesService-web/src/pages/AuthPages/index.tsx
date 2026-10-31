import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { ADMIN_SCOPE } from '@/api/admin';
import { login, register } from '@/api/auth';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { photoAt } from '@/components/attractions/AttractionCard';
import { DEMO_ATTRACTIONS } from '@/features/attractions/demoCatalog';
import { AuthError } from '@/features/auth/session';
import { hasScope, useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { paths, safeReturnPath } from '@/utils/routes';

const loginSchema = z.object({
  email: z.string().trim().email('Introduce un correo válido.'),
  password: z.string().min(1, 'Indica tu contraseña.'),
});

const registerSchema = z
  .object({
    name: z.string().trim().min(1, 'Indica tu nombre.').max(200, 'Máximo 200 caracteres.'),
    email: z.string().trim().email('Introduce un correo válido.').max(254),
    password: z
      .string()
      .min(8, 'Mínimo 8 caracteres.')
      .max(128, 'Máximo 128 caracteres.')
      .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Incluye mayúscula, minúscula y número.'),
    confirm: z.string(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar los términos de uso.' }) }),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden.' });

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;

/**
 * Sin ruta solicitada, los administradores entran directamente al panel. Un cliente nunca vuelve al panel
 * (p. ej. `returnTo=/admin` tras cerrar la sesión de un administrador): va a la página principal.
 */
function destination(returnTo: string) {
  const isAdmin = hasScope(useAuthStore.getState().claims, ADMIN_SCOPE);
  const adminPath = returnTo === paths.admin() || returnTo.startsWith(`${paths.admin()}/`) || returnTo.startsWith(`${paths.admin()}?`);
  if (isAdmin) return returnTo === '/' ? paths.admin() : returnTo;
  return adminPath ? paths.home() : returnTo;
}

/** Si ya hay sesión, vuelve directamente a la ruta solicitada. */
function useReturnTo() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = safeReturnPath(params.get('returnTo'));
  const authenticated = useAuthStore((s) => s.status === 'authenticated');
  useEffect(() => {
    if (authenticated) navigate(destination(returnTo), { replace: true });
  }, [authenticated, navigate, returnTo]);
  return returnTo;
}

/** Une el mensaje del servicio y los errores por campo. */
function describe(error: unknown): { message: string; fields: Record<string, string[]> } {
  if (error instanceof AuthError) return { message: error.message, fields: error.fieldErrors };
  return { message: 'No se pudo completar la operación. Inténtalo de nuevo.', fields: {} };
}

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const photo = DEMO_ATTRACTIONS[3].photos[0].url;
  return (
    <div className="page-container grid grid-cols-1 gap-8 py-10 lg:grid-cols-[1fr_440px]">
      <section aria-hidden="true" className="relative hidden overflow-hidden rounded-lg lg:block">
        <img src={photoAt(photo, 960)} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-night/80 via-night/20 to-transparent" />
        <p className="absolute bottom-8 left-8 right-8 text-2xl text-white">
          Volcanes, lagunas y ciudades coloniales.
          <br />
          <strong>Ecuador te espera.</strong>
        </p>
      </section>
      <section className="card-surface p-6 shadow-card sm:p-8">
        <h1 className="text-3xl">{title}</h1>
        <p className="mt-1 text-ink-soft">{subtitle}</p>
        <div className="mt-6">{children}</div>
        <p className="mt-6 flex items-start gap-2 text-xs text-ink-soft">
          <ShieldCheck size={16} className="shrink-0 text-success" aria-hidden="true" />
          Tu contraseña se guarda cifrada y tu sesión solo se mantiene en esta pestaña.
        </p>
      </section>
    </div>
  );
}

export function LoginPage() {
  const returnTo = useReturnTo();
  const navigate = useNavigate();
  const notify = useUiStore((s) => s.notify);
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const submit = handleSubmit(async (values) => {
    try {
      await login(values.email, values.password);
      notify('¡Hola de nuevo!', 'success');
      navigate(destination(returnTo), { replace: true });
    } catch (error) {
      setError('root', { message: describe(error).message });
    }
  });

  return (
    <AuthLayout title="Iniciar sesión" subtitle="Accede para reservar y comprar experiencias en Ecuador.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {sessionExpired && <Alert>Tu sesión expiró. Vuelve a iniciar sesión para continuar.</Alert>}
        <Input label="Correo electrónico" type="email" autoComplete="email" autoFocus error={errors.email?.message} {...field('email')} />
        <Input label="Contraseña" type="password" autoComplete="current-password" error={errors.password?.message} {...field('password')} />
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          Iniciar sesión
        </Button>
      </form>
      <p className="mt-6 text-center text-ink-soft">
        ¿No tienes cuenta?{' '}
        <Link to={paths.register(returnTo)} className="link">
          Crear una cuenta
        </Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const returnTo = useReturnTo();
  const navigate = useNavigate();
  const notify = useUiStore((s) => s.notify);
  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema), mode: 'onTouched' });

  const submit = handleSubmit(async (values) => {
    try {
      await register(values.name, values.email, values.password);
      notify('¡Cuenta creada! Ya puedes reservar.', 'success');
      navigate(destination(returnTo), { replace: true });
    } catch (error) {
      const { message, fields } = describe(error);
      for (const [name, messages] of Object.entries(fields)) {
        if (name === 'name' || name === 'email' || name === 'password') setError(name, { message: messages[0] });
      }
      setError('root', { message });
    }
  });

  return (
    <AuthLayout title="Crear cuenta" subtitle="Regístrate gratis para reservar tours, entradas y experiencias.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Input label="Nombre" autoComplete="name" autoFocus error={errors.name?.message} {...field('name')} />
        <Input label="Correo electrónico" type="email" autoComplete="email" error={errors.email?.message} {...field('email')} />
        <Input
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          help="Mínimo 8 caracteres, con mayúscula, minúscula y número."
          error={errors.password?.message}
          {...field('password')}
        />
        <Input label="Repite la contraseña" type="password" autoComplete="new-password" error={errors.confirm?.message} {...field('confirm')} />
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-[18px] w-[18px] accent-[#C94D6B]" {...field('acceptTerms')} />
          <span>
            Acepto los <Link to="/ayuda#terminos" className="link">términos de uso</Link> y la{' '}
            <Link to="/ayuda#privacidad" className="link">política de privacidad</Link>.
          </span>
        </label>
        {errors.acceptTerms && <p className="field-error">{errors.acceptTerms.message}</p>}
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          Crear cuenta
        </Button>
      </form>
      <p className="mt-6 text-center text-ink-soft">
        ¿Ya tienes cuenta?{' '}
        <Link to={paths.login(returnTo)} className="link">
          Iniciar sesión
        </Link>
      </p>
    </AuthLayout>
  );
}
