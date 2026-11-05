import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { confirmPasswordRecovery, login, register, requestPasswordRecovery, verifyEmail } from '@/api/auth';
import { Button, ButtonLink } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { AUTH_PHOTO, photoAt } from '@/features/content/photos';
import { hasRole, useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { ApiError, errorMessage } from '@/utils/api';
import { paths, safeReturnPath } from '@/utils/routes';
import {
  loginSchema,
  recoverySchema,
  registerSchema,
  resetPasswordSchema,
  type LoginValues,
  type RegisterValues,
} from '@/utils/validation';

/**
 * Sin ruta solicitada, los administradores entran directamente al panel. Quien no es administrador nunca vuelve al
 * panel (p. ej. `returnTo=/admin` tras cerrar la sesión de un administrador): va a la página principal.
 */
function destination(returnTo: string) {
  const isAdmin = hasRole(useAuthStore.getState().user, 'ADMIN');
  const adminPath = returnTo === paths.admin() || returnTo.startsWith(`${paths.admin()}/`) || returnTo.startsWith(`${paths.admin()}?`);
  if (isAdmin) return returnTo === '/' ? paths.admin() : returnTo;
  return adminPath && !returnTo.startsWith('/admin/checkin') ? paths.home() : returnTo;
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

/** Copia los errores por campo de Identity (`invalid_params`) al formulario y deja el mensaje general. */
function showErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: Path<T>[]) {
  if (error instanceof ApiError) {
    for (const name of fields) {
      const message = error.fieldErrors[name]?.[0];
      if (message) setError(name, { message });
    }
  }
  setError('root' as Path<T>, { message: errorMessage(error) });
}

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="page-container grid grid-cols-1 gap-8 py-10 lg:grid-cols-[1fr_440px]">
      <section aria-hidden="true" className="relative hidden overflow-hidden rounded-lg lg:block">
        <img src={photoAt(AUTH_PHOTO, 960)} alt="" className="absolute inset-0 h-full w-full object-cover" />
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
      const user = await login(values.correo, values.password);
      notify(`¡Hola de nuevo, ${user.nombre}!`, 'success');
      navigate(destination(returnTo), { replace: true });
    } catch (error) {
      showErrors(error, setError, ['correo', 'password']);
    }
  });

  return (
    <AuthLayout title="Iniciar sesión" subtitle="Accede para comprar experiencias y ver tus reservas.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {sessionExpired && <Alert>Tu sesión expiró. Vuelve a iniciar sesión para continuar.</Alert>}
        <Input label="Correo electrónico" type="email" autoComplete="email" autoFocus error={errors.correo?.message} {...field('correo')} />
        <Input label="Contraseña" type="password" autoComplete="current-password" error={errors.password?.message} {...field('password')} />
        <p className="text-right text-sm">
          <Link to={paths.recover()} className="link">
            ¿Olvidaste tu contraseña?
          </Link>
        </p>
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
      await register({
        correo: values.correo.trim().toLowerCase(),
        password: values.password,
        nombre: values.nombre.trim(),
        apellido: values.apellido.trim(),
        telefono: values.telefono?.trim() || null,
      });
      notify('¡Cuenta creada! Te enviamos un correo para verificarla.', 'success');
      navigate(destination(returnTo), { replace: true });
    } catch (error) {
      showErrors(error, setError, ['nombre', 'apellido', 'correo', 'telefono', 'password']);
    }
  });

  return (
    <AuthLayout title="Crear cuenta" subtitle="Regístrate gratis para comprar tours, entradas y experiencias.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nombre" autoComplete="given-name" autoFocus error={errors.nombre?.message} {...field('nombre')} />
          <Input label="Apellido" autoComplete="family-name" error={errors.apellido?.message} {...field('apellido')} />
        </div>
        <Input label="Correo electrónico" type="email" autoComplete="email" error={errors.correo?.message} {...field('correo')} />
        <Input label="Teléfono (opcional)" type="tel" autoComplete="tel" error={errors.telefono?.message} {...field('telefono')} />
        <Input
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          help="Entre 8 y 72 caracteres."
          error={errors.password?.message}
          {...field('password')}
        />
        <Input label="Repite la contraseña" type="password" autoComplete="new-password" error={errors.confirm?.message} {...field('confirm')} />
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-[18px] w-[18px] accent-[#C94D6B]" {...field('acceptTerms')} />
          <span>
            Acepto los{' '}
            <Link to={paths.help('terminos')} className="link">
              términos de uso
            </Link>{' '}
            y la{' '}
            <Link to={paths.help('privacidad')} className="link">
              política de privacidad
            </Link>
            .
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

/** Pide el enlace de recuperación. Identity responde igual exista o no la cuenta. */
export function RecoverPage() {
  const [sent, setSent] = useState(false);
  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof recoverySchema>>({ resolver: zodResolver(recoverySchema) });

  const submit = handleSubmit(async ({ correo }) => {
    try {
      await requestPasswordRecovery(correo);
      setSent(true);
    } catch (error) {
      showErrors(error, setError, ['correo']);
    }
  });

  return (
    <AuthLayout title="Recuperar contraseña" subtitle="Te enviaremos un enlace para crear una contraseña nueva.">
      {sent ? (
        <Alert tone="success">Si el correo está registrado, recibirás un enlace en unos minutos. Revisa también la carpeta de spam.</Alert>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Input label="Correo electrónico" type="email" autoComplete="email" autoFocus error={errors.correo?.message} {...field('correo')} />
          {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Enviar enlace
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-ink-soft">
        <Link to={paths.login()} className="link">
          Volver a iniciar sesión
        </Link>
      </p>
    </AuthLayout>
  );
}

/** Destino del enlace del correo de recuperación: `/recuperar-clave?token=`. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetPasswordSchema>>({ resolver: zodResolver(resetPasswordSchema) });

  const submit = handleSubmit(async ({ password }) => {
    try {
      await confirmPasswordRecovery(token, password);
      setDone(true);
    } catch (error) {
      showErrors(error, setError, ['password']);
    }
  });

  return (
    <AuthLayout title="Nueva contraseña" subtitle="Elige una contraseña nueva para tu cuenta.">
      {!token ? (
        <Alert tone="error">El enlace no es válido. Solicita uno nuevo desde “¿Olvidaste tu contraseña?”.</Alert>
      ) : done ? (
        <div className="space-y-4">
          <Alert tone="success">Tu contraseña se actualizó. Ya puedes iniciar sesión.</Alert>
          <ButtonLink to={paths.login()} fullWidth>
            Iniciar sesión
          </ButtonLink>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Input label="Contraseña nueva" type="password" autoComplete="new-password" autoFocus help="Entre 8 y 72 caracteres." error={errors.password?.message} {...field('password')} />
          <Input label="Repite la contraseña" type="password" autoComplete="new-password" error={errors.confirm?.message} {...field('confirm')} />
          {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            Guardar contraseña
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

/** Destino del enlace de verificación: `/verificar-correo?token=`. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<{ status: 'loading' | 'done' | 'error'; error?: unknown }>({ status: token ? 'loading' : 'error' });

  useEffect(() => {
    if (!token) return;
    verifyEmail(token).then(
      () => setState({ status: 'done' }),
      (error: unknown) => setState({ status: 'error', error }),
    );
  }, [token]);

  return (
    <AuthLayout title="Verificar correo" subtitle="Confirmamos que el correo de tu cuenta es tuyo.">
      {state.status === 'loading' && <div className="skeleton h-12" aria-busy="true" />}
      {state.status === 'done' && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 size={22} aria-hidden="true" /> Tu correo quedó verificado.
          </p>
          <ButtonLink to={paths.home()} fullWidth>
            Ir al inicio
          </ButtonLink>
        </div>
      )}
      {state.status === 'error' && (
        <Alert tone="error">{state.error ? errorMessage(state.error) : 'El enlace no es válido.'} Puedes pedir otro desde “Mi cuenta”.</Alert>
      )}
    </AuthLayout>
  );
}
