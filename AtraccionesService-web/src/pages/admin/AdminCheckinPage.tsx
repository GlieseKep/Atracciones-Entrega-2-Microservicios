import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CameraOff, QrCode, Search, UserCheck } from 'lucide-react';
import { checkIn, getReservation } from '@/api/bookings';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input, TextArea } from '@/components/common/Input';
import { ReservationStatusBadge } from '@/components/profile/StatusBadge';
import { useAuth } from '@/hooks/useAuth';
import type { BookingNotificationStatus, CheckinResult, Reservation } from '@/types/booking';
import { errorMessage, isApiError } from '@/utils/api';
import { formatDate } from '@/utils/dates';

/** `BarcodeDetector` (Chrome, Edge, Android) todavía no está en los tipos de TypeScript. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;
const BarcodeDetectorApi = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

/** El QR es `<datos en base64url>.<firma>`; los datos traen el PNR (`pnr`) de la reserva. */
function readVoucher(value: string): { code: string; voucher: string | null } {
  const text = value.trim();
  const [body, signature] = text.split('.');
  if (body && signature) {
    try {
      const json = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as { pnr?: string; res_id?: string };
      const code = json.pnr ?? json.res_id;
      if (code) return { code, voucher: text };
    } catch {
      // No es un voucher: se toma como código de reserva.
    }
  }
  return { code: text.toUpperCase(), voucher: null };
}

const NOTIFICATION: Record<BookingNotificationStatus, [string, 'neutral' | 'success' | 'warning' | 'danger']> = {
  NO_APLICA: ['No aplica (compra web)', 'neutral'],
  PENDIENTE: ['Pendiente de envío', 'warning'],
  ENVIADA: ['Enviada a Booking', 'success'],
  FALLIDA: ['Falló el envío', 'danger'],
};

function NotificationBadge({ status }: { status?: BookingNotificationStatus }) {
  const [label, tone] = NOTIFICATION[status ?? 'NO_APLICA'];
  return <Badge tone={tone}>{label}</Badge>;
}

const CHECKIN_MESSAGES: Record<string, string> = {
  DOCUMENT_MISMATCH: 'El documento no coincide con el del titular de la reserva.',
  INVALID_VOUCHER: 'El código QR no es válido para esta reserva.',
  RESERVATION_NOT_CONFIRMED: 'La reserva no está confirmada: no se puede hacer el check-in.',
  CHECKIN_OUT_OF_WINDOW: 'El check-in solo se puede hacer el día de la actividad.',
  RESERVATION_NOT_FOUND: 'No existe una reserva con ese código.',
};

const message = (error: unknown) => (isApiError(error) && error.code && CHECKIN_MESSAGES[error.code]) || errorMessage(error);

/** Escanea el QR con la cámara mientras está abierta; devuelve el primer valor leído. */
function QrScanner({ onRead, onClose }: { onRead: (value: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!BarcodeDetectorApi) return;
    const detector = new BarcodeDetectorApi({ formats: ['qr_code'] });
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (media) => {
        stream = media;
        if (stopped || !video.current) return;
        video.current.srcObject = media;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          const [code] = await detector.detect(video.current).catch(() => []);
          if (code?.rawValue) onRead(code.rawValue);
          else timer = window.setTimeout(() => void tick(), 300);
        };
        void tick();
      })
      .catch(() => setError('No se pudo abrir la cámara. Escriba el código de la reserva.'));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onRead]);

  return (
    <div className="mt-4 space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : <video ref={video} className="w-full max-w-sm rounded-md bg-black" muted playsInline />}
      <Button variant="secondary" size="sm" onClick={onClose}>
        <CameraOff size={16} aria-hidden="true" /> Cerrar cámara
      </Button>
    </div>
  );
}

/**
 * Check-in presencial en el punto de encuentro: el guía escanea el QR (o escribe el código), comprueba el documento del
 * titular y confirma la asistencia. Si la compra vino de Booking, ms-booking le avisa a Booking Central.
 */
export default function AdminCheckinPage() {
  const { hasRole } = useAuth();
  const allowed = hasRole('ADMIN') || hasRole('OPERADOR') || hasRole('GUIA');

  const [code, setCode] = useState('');
  const [voucher, setVoucher] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [documento, setDocumento] = useState('');
  const [asistentes, setAsistentes] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [guiaCodigo, setGuiaCodigo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckinResult | null>(null);
  // La misma clave en los reintentos de una confirmación: Booking devuelve el pase ya emitido sin duplicar.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  async function lookup(value: string, scannedVoucher: string | null) {
    setLookupError(null);
    setReservation(null);
    setResult(null);
    setCheckinError(null);
    if (!value.trim()) return;
    setSearching(true);
    try {
      const found = await getReservation(value.trim());
      setReservation(found);
      setVoucher(scannedVoucher);
      setAsistentes(String(found.ticket_count));
      idempotencyKey.current = crypto.randomUUID();
    } catch (error) {
      setLookupError(message(error));
    } finally {
      setSearching(false);
    }
  }

  function onScanned(value: string) {
    setScanning(false);
    const read = readVoucher(value);
    setCode(read.code);
    void lookup(read.code, read.voucher);
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const read = readVoucher(code);
    void lookup(read.code, read.voucher);
  }

  async function onConfirm(event: FormEvent) {
    event.preventDefault();
    if (!reservation) return;
    setCheckinError(null);
    const count = Number(asistentes);
    if (!Number.isInteger(count) || count < 1 || count > reservation.ticket_count) {
      setCheckinError(`Los asistentes deben ser entre 1 y ${reservation.ticket_count}.`);
      return;
    }
    setSubmitting(true);
    try {
      const response = await checkIn(
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
      );
      setResult(response);
      setReservation({ ...reservation, status: response.estado, notificacion_booking: response.notificacion_booking });
    } catch (error) {
      setCheckinError(message(error));
    } finally {
      setSubmitting(false);
    }
  }

  /** El aviso a Booking sale en segundo plano: se vuelve a leer la reserva para ver si ya se envió. */
  async function refreshNotification() {
    if (!reservation) return;
    try {
      setReservation(await getReservation(reservation.reservation_id));
    } catch (error) {
      setCheckinError(message(error));
    }
  }

  if (!allowed) {
    return (
      <div className="page-container pt-8">
        <Alert tone="error">El check-in lo hacen un guía, un operador o un administrador.</Alert>
      </div>
    );
  }

  return (
    <div className="page-container max-w-3xl space-y-6 pt-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-500">Punto de encuentro</p>
        <h1 className="mt-1 text-2xl">Check-in de turistas</h1>
        <p className="mt-1 text-sm text-ink-soft">Escanee el QR del voucher o escriba el código de la reserva, y compruebe el documento del titular.</p>
      </header>

      <section className="card-surface p-6" aria-labelledby="lookup-title">
        <h2 id="lookup-title" className="flex items-center gap-2 text-lg">
          <QrCode size={18} aria-hidden="true" /> Reserva
        </h2>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onSearch}>
          <Input label="Código de reserva o QR" value={code} onChange={(e) => setCode(e.target.value)} placeholder="DEC-XXXXXX" className="flex-1" />
          <Button type="submit" loading={searching} disabled={!code.trim()}>
            <Search size={16} aria-hidden="true" /> Buscar
          </Button>
          {BarcodeDetectorApi && !scanning && (
            <Button type="button" variant="secondary" onClick={() => setScanning(true)}>
              <Camera size={16} aria-hidden="true" /> Escanear QR
            </Button>
          )}
        </form>
        {scanning && <QrScanner onRead={onScanned} onClose={() => setScanning(false)} />}
        {lookupError && (
          <Alert tone="error" className="mt-4">
            {lookupError}
          </Alert>
        )}
      </section>

      {reservation && (
        <section className="card-surface p-6" aria-labelledby="detail-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="detail-title" className="text-lg">
              {reservation.reservation_code}
            </h2>
            <ReservationStatusBadge status={reservation.status} />
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">Titular</dt>
              <dd className="font-semibold">{reservation.customer.full_name}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Documento esperado</dt>
              <dd>{reservation.customer.document_type}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Visita</dt>
              <dd>
                {formatDate(reservation.date)} · {reservation.time}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Boletos</dt>
              <dd>{reservation.ticket_count}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Punto de encuentro</dt>
              <dd>{reservation.punto_encuentro || 'Sin definir'}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Aviso a Booking</dt>
              <dd>
                <NotificationBadge status={reservation.notificacion_booking} />
              </dd>
            </div>
          </dl>
          {voucher && <p className="mt-3 text-xs text-success">QR leído: se validará la firma del voucher.</p>}

          {reservation.status === 'CONFIRMED' && !result && (
            <form className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-2" onSubmit={onConfirm}>
              <Input label="Documento que presenta el turista" value={documento} onChange={(e) => setDocumento(e.target.value)} required autoComplete="off" />
              <Input
                label="Asistentes reales"
                type="number"
                min={1}
                max={reservation.ticket_count}
                value={asistentes}
                onChange={(e) => setAsistentes(e.target.value)}
                required
              />
              <Input label="Código del guía (opcional)" value={guiaCodigo} onChange={(e) => setGuiaCodigo(e.target.value)} maxLength={30} />
              <TextArea
                label="Observaciones (opcional)"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                maxLength={500}
                rows={2}
                className="sm:col-span-2"
              />
              {checkinError && (
                <Alert tone="error" className="sm:col-span-2">
                  {checkinError}
                </Alert>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" loading={submitting} disabled={!documento.trim()}>
                  <UserCheck size={16} aria-hidden="true" /> Confirmar asistencia
                </Button>
              </div>
            </form>
          )}
          {reservation.status !== 'CONFIRMED' && !result && (
            <Alert tone="info" className="mt-4">
              Esta reserva está en estado {reservation.status}: solo una reserva confirmada admite el check-in.
            </Alert>
          )}
        </section>
      )}

      {result && (
        <section className="card-surface p-6" aria-labelledby="pass-title">
          <Alert tone="success">
            Asistencia confirmada para {result.titular_nombre} a las {new Date(result.hora_checkin).toLocaleTimeString()}.
          </Alert>
          <h2 id="pass-title" className="mt-4 text-lg">
            Pase de abordar
          </h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">Guía</dt>
              <dd>{result.guia_asignado}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Punto de encuentro</dt>
              <dd>{result.punto_encuentro || 'Sin definir'}</dd>
            </div>
          </dl>
          <p className="mt-3 break-all rounded-sm bg-surface p-2 font-mono text-[11px] text-ink-soft">{result.pase_abordar_qr}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <NotificationBadge status={reservation?.notificacion_booking ?? result.notificacion_booking} />
            {(reservation?.notificacion_booking ?? result.notificacion_booking) === 'PENDIENTE' && (
              <Button variant="tertiary" size="sm" onClick={() => void refreshNotification()}>
                Actualizar estado del aviso
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
