import { useRef, useState, type FormEvent } from 'react';
import { UserCheck } from 'lucide-react';
import { checkIn } from '@/api/bookings';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input, TextArea } from '@/components/common/Input';
import type { CheckinResult, Reservation } from '@/types/booking';
import { errorMessage, isApiError } from '@/utils/api';

const CHECKIN_MESSAGES: Record<string, string> = {
  DOCUMENT_MISMATCH: 'El documento no coincide con el del titular de la reserva.',
  INVALID_VOUCHER: 'El código QR no es válido para esta reserva.',
  RESERVATION_NOT_CONFIRMED: 'La reserva no está confirmada: no se puede hacer el check-in.',
  CHECKIN_OUT_OF_WINDOW: 'El check-in solo se puede hacer el día de la actividad.',
  RESERVATION_NOT_FOUND: 'No existe una reserva con ese código.',
};

export const checkinMessage = (error: unknown) => (isApiError(error) && error.code && CHECKIN_MESSAGES[error.code]) || errorMessage(error);

interface Props {
  reservation: Reservation;
  /** QR escaneado: Booking valida su firma. */
  voucher?: string | null;
  onDone: (result: CheckinResult) => void;
}

/**
 * Confirma la asistencia de una reserva. El documento viene con el del titular, pero se confirma haberlo visto: Booking
 * lo sigue comparando. Se monta con `key` por reserva, y la clave de idempotencia dura lo que el formulario, así que un
 * reintento devuelve el pase ya emitido sin duplicar.
 */
export function CheckinForm({ reservation, voucher = null, onDone }: Props) {
  const [documento, setDocumento] = useState(reservation.customer.document_id ?? '');
  const [verified, setVerified] = useState(false);
  const [asistentes, setAsistentes] = useState(String(reservation.ticket_count));
  const [observaciones, setObservaciones] = useState('');
  const [guiaCodigo, setGuiaCodigo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const count = Number(asistentes);
    if (!Number.isInteger(count) || count < 1 || count > reservation.ticket_count) {
      setError(`Los asistentes deben ser entre 1 y ${reservation.ticket_count}.`);
      return;
    }
    setSubmitting(true);
    try {
      onDone(
        await checkIn(
          {
            id: reservation.reservation_id,
            documento_identidad: documento.trim().toUpperCase(),
            ...(voucher ? { codigo_voucher_qr: voucher } : {}),
            ...(guiaCodigo.trim() ? { guia_codigo: guiaCodigo.trim() } : {}),
            scanner_device_id: 'portal-web',
            asistentes_reales: count,
            ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
          },
          idempotencyKey.current,
        ),
      );
    } catch (failure) {
      setError(checkinMessage(failure));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2" onSubmit={onSubmit}>
      <Input label="Documento del titular" value={documento} onChange={(e) => setDocumento(e.target.value)} required autoComplete="off" />
      <Input label="Asistentes reales" type="number" min={1} max={reservation.ticket_count} value={asistentes} onChange={(e) => setAsistentes(e.target.value)} required />
      <Input label="Código del guía (opcional)" value={guiaCodigo} onChange={(e) => setGuiaCodigo(e.target.value)} maxLength={30} />
      <TextArea label="Observaciones (opcional)" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} maxLength={500} rows={2} className="sm:col-span-2" />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        Verifiqué el documento físico
      </label>
      {error && (
        <Alert tone="error" className="sm:col-span-2">
          {error}
        </Alert>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" loading={submitting} disabled={!documento.trim() || !verified}>
          <UserCheck size={16} aria-hidden="true" /> Confirmar Asistencia
        </Button>
      </div>
    </form>
  );
}
