import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogOut, MailCheck } from 'lucide-react';
import { changePassword, getMe, resendVerification, updateMe } from '@/api/auth';
import { Button } from '@/components/common/Button';
import { Alert, ErrorState } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { BillingProfiles } from '@/components/profile/BillingProfiles';
import { ProfileCard } from '@/components/profile/ProfileCard';
import { ReservationHistory } from '@/components/profile/ReservationHistory';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import type { User } from '@/types/identity';
import { errorMessage, fieldError } from '@/utils/api';
import { changePasswordSchema, profileSchema, type ChangePasswordValues, type ProfileValues } from '@/utils/validation';

const TABS = [
  { id: 'datos', label: 'Datos personales' },
  { id: 'facturacion', label: 'Facturación' },
  { id: 'reservas', label: 'Reservas' },
  { id: 'seguridad', label: 'Seguridad' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function ProfilePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'datos') as TabId;
  const { signOut } = useAuth();
  // El usuario de la sesión se refresca desde ms-identity (`identityGetMe`) al abrir el perfil.
  const me = useAsync(async (signal) => {
    const user = await getMe(signal);
    useAuthStore.getState().setUser(user);
    return user;
  }, []);
  const user = me.data ?? useAuthStore.getState().user;

  return (
    <div className="page-container pt-8">
      <h1 className="text-3xl">Mi cuenta</h1>
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Secciones del perfil">
          <ul className="scrollbar-none flex gap-1 overflow-x-auto lg:flex-col">
            {TABS.map((t) => (
              <li key={t.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setParams({ tab: t.id })}
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={`w-full rounded-sm px-4 py-2.5 text-left text-sm font-semibold transition ${
                    tab === t.id ? 'bg-brand-50 text-brand-600 lg:border-l-4 lg:border-brand-500' : 'hover:bg-surface'
                  }`}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-label={TABS.find((t) => t.id === tab)?.label} className="min-w-0">
          {me.status === 'error' && !user ? (
            <ErrorState error={me.error} onRetry={me.retry} />
          ) : !user ? (
            <div className="skeleton h-64" aria-busy="true" />
          ) : (
            <>
              {tab === 'datos' && (
                <div className="space-y-4">
                  <ProfileCard user={user} />
                  <PersonalDataForm user={user} onSaved={me.setData} />
                </div>
              )}
              {tab === 'facturacion' && <BillingProfiles fallbackEmail={user.correo} />}
              {tab === 'reservas' && <ReservationHistory />}
              {tab === 'seguridad' && (
                <div className="space-y-6">
                  {!user.verificado && <VerifyEmailCard />}
                  <PasswordForm />
                  <div className="card-surface space-y-3 p-5">
                    <h2 className="text-lg">Sesión</h2>
                    <p className="text-sm text-ink-soft">
                      Por seguridad, la sesión vive solo en esta pestaña: al cerrarla o recargarla tendrás que volver a iniciar sesión.
                    </p>
                    <Button variant="danger" onClick={signOut}>
                      <LogOut size={16} aria-hidden="true" /> Cerrar sesión
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function PersonalDataForm({ user, onSaved }: { user: User; onSaved: (user: User) => void }) {
  const notify = useUiStore((s) => s.notify);
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    mode: 'onTouched',
    values: {
      nombre: user.nombre,
      apellido: user.apellido,
      telefono: user.telefono ?? '',
      fecha_nacimiento: user.fecha_nacimiento ?? '',
    },
  });

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const updated = await updateMe({
        nombre: v.nombre,
        apellido: v.apellido,
        telefono: v.telefono || null,
        fecha_nacimiento: v.fecha_nacimiento || null,
      });
      onSaved(updated);
      notify('Datos guardados.', 'success');
    } catch (e) {
      setError(e);
    }
  });

  const err = (name: keyof ProfileValues) => errors[name]?.message ?? fieldError(error, name);

  return (
    <form onSubmit={submit} noValidate className="card-surface space-y-4 p-5">
      <h2 className="text-lg">Datos personales</h2>
      <p className="text-sm text-ink-soft">Los usamos para completar el titular de tus compras.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nombre" autoComplete="given-name" error={err('nombre')} {...register('nombre')} />
        <Input label="Apellido" autoComplete="family-name" error={err('apellido')} {...register('apellido')} />
        <Input
          label="Cédula o pasaporte"
          value={user.documento ?? 'Sin registrar'}
          disabled
          readOnly
          help="Solo un administrador puede cambiarla. Escríbenos desde Ayuda si hay un error."
        />
        <Input label="Teléfono (opcional)" type="tel" autoComplete="tel" error={err('telefono')} {...register('telefono')} />
        <Input label="Fecha de nacimiento (opcional)" type="date" error={err('fecha_nacimiento')} {...register('fecha_nacimiento')} />
        <Input label="Correo" value={user.correo} disabled readOnly help="El correo no se puede cambiar." />
      </div>
      {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const notify = useUiStore((s) => s.notify);
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema), mode: 'onTouched' });

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await changePassword(v.actual, v.nuevo);
      reset({ actual: '', nuevo: '', confirm: '' });
      notify('Contraseña actualizada. Las demás sesiones se cerraron.', 'success');
    } catch (e) {
      setError(e);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="card-surface space-y-4 p-5">
      <h2 className="text-lg">Cambiar contraseña</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Contraseña actual" type="password" autoComplete="current-password" error={errors.actual?.message} {...register('actual')} />
        <Input
          label="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          error={errors.nuevo?.message ?? fieldError(error, 'password_nuevo')}
          {...register('nuevo')}
        />
        <Input label="Repite la nueva" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
      </div>
      {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting}>
          Cambiar contraseña
        </Button>
      </div>
    </form>
  );
}

function VerifyEmailCard() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<unknown>(null);
  const send = async () => {
    setState('sending');
    setError(null);
    try {
      await resendVerification();
      setState('sent');
    } catch (e) {
      setError(e);
      setState('idle');
    }
  };
  return (
    <div className="card-surface space-y-3 p-5">
      <h2 className="flex items-center gap-2 text-lg">
        <MailCheck size={18} aria-hidden="true" /> Verifica tu correo
      </h2>
      {state === 'sent' ? (
        <Alert tone="success">Te enviamos un enlace nuevo. Revisa tu bandeja de entrada.</Alert>
      ) : (
        <>
          <p className="text-sm text-ink-soft">Aún no confirmas tu correo. Te enviamos un enlace al registrarte; puedes pedir otro.</p>
          {error !== null && <Alert tone="error">{errorMessage(error)}</Alert>}
          <Button variant="secondary" loading={state === 'sending'} onClick={send}>
            Reenviar enlace
          </Button>
        </>
      )}
    </div>
  );
}
