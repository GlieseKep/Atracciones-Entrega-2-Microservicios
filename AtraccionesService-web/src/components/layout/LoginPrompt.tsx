import { LogIn, ShieldCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/uiStore';

/** Diálogo para iniciar sesión o crear una cuenta antes de reservar o comprar (Viator lo pide al pagar). */
export function LoginPrompt() {
  const prompt = useUiStore((s) => s.loginPrompt);
  const close = useUiStore((s) => s.closeLoginPrompt);
  const { signIn, signUp } = useAuth();

  const go = (action: typeof signIn) => {
    const returnTo = prompt?.returnTo;
    close();
    void action(returnTo);
  };

  return (
    <Modal
      open={!!prompt}
      onClose={close}
      title="Inicia sesión para continuar"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => go(signUp)}>
            <UserPlus size={18} aria-hidden="true" /> Crear cuenta
          </Button>
          <Button onClick={() => go(signIn)}>
            <LogIn size={18} aria-hidden="true" /> Iniciar sesión
          </Button>
        </>
      }
    >
      <p className="text-ink-soft">{prompt?.reason ?? 'Necesitas una cuenta para reservar y comprar experiencias.'}</p>
      <p className="mt-4 flex items-start gap-2 text-sm text-ink-soft">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        Te llevaremos al acceso seguro de TourGirls. Crear una cuenta es gratis y solo toma un minuto.
      </p>
    </Modal>
  );
}
