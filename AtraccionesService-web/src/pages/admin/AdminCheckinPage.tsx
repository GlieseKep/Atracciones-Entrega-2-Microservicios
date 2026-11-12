import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CameraOff, QrCode, Search } from 'lucide-react';
import { operationsApi } from '@/api/admin';
import { getReservation } from '@/api/bookings';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Feedback';
import { Input } from '@/components/common/Input';
import { adminReservationStatusLabel, AdminReservationStatusBadge } from '@/components/profile/StatusBadge';
import { useAuth } from '@/hooks/useAuth';
import type { BookingNotificationStatus, CheckinResult, Reservation } from '@/types/booking';
import { formatDate, isCheckinDay } from '@/utils/dates';
import { CheckinForm, checkinMessage } from './CheckinForm';

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
 * Check-in presencial en el punto de encuentro: el guía escanea el QR (o busca por código, cédula o correo), comprueba el documento del
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

  const [matches, setMatches] = useState<Reservation[]>([]);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckinResult | null>(null);

  function select(found: Reservation, scannedVoucher: string | null) {
    setReservation(found);
    setVoucher(scannedVoucher);
    setMatches([]);
  }

  /** Con un QR, la reserva es esa; con texto, puede haber varias del mismo titular y se elige una. */
  async function lookup(value: string, scannedVoucher: string | null) {
    setLookupError(null);
    setReservation(null);
    setMatches([]);
    setResult(null);
    setRefreshError(null);
    if (!value.trim()) return;
    setSearching(true);
    try {
      if (scannedVoucher) {
        select(await getReservation(value.trim()), scannedVoucher);
        return;
      }
      const { items } = await operationsApi.reservations({ q: value.trim(), page: 1, limit: 20 });
      if (items.length === 0) setLookupError('No encontramos reservas con ese código, cédula o correo.');
      else if (items.length === 1) select(items[0], null);
      else setMatches(items);
    } catch (error) {
      setLookupError(checkinMessage(error));
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

  function onCheckedIn(response: CheckinResult) {
    setResult(response);
    setReservation((current) => current && { ...current, status: response.estado, notificacion_booking: response.notificacion_booking });
  }

  /** El aviso a Booking sale en segundo plano: se vuelve a leer la reserva para ver si ya se envió. */
  async function refreshNotification() {
    if (!reservation) return;
    try {
      setReservation(await getReservation(reservation.reservation_id));
    } catch (error) {
      setRefreshError(checkinMessage(error));
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
        <p className="mt-1 text-sm text-ink-soft">Escanee el QR del voucher o busque por código, cédula o correo, y compruebe el documento del titular.</p>
      </header>

      <section className="card-surface p-6" aria-labelledby="lookup-title">
        <h2 id="lookup-title" className="flex items-center gap-2 text-lg">
          <QrCode size={18} aria-hidden="true" /> Reserva
        </h2>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onSearch}>
          <Input label="Código, cédula, correo o QR" value={code} onChange={(e) => setCode(e.target.value)} placeholder="DEC-XXXXXX" className="flex-1" />
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
        {matches.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-md border border-line">
            {matches.map((match) => (
              <li key={match.reservation_id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <span>
                  <span className="font-semibold">{match.reservation_code}</span> · {match.customer.full_name} · {formatDate(match.date)} · {match.time}
                  <span className="mt-1 block">
                    <AdminReservationStatusBadge status={match.status} />
                  </span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => select(match, null)}>
                  Elegir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {reservation && (
        <section className="card-surface p-6" aria-labelledby="detail-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="detail-title" className="text-lg">
              {reservation.reservation_code}
            </h2>
            <AdminReservationStatusBadge status={reservation.status} />
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">Titular</dt>
              <dd className="font-semibold">{reservation.customer.full_name}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Documento esperado</dt>
              <dd>
                {reservation.customer.document_type} {reservation.customer.document_id}
              </dd>
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

          {reservation.status === 'CONFIRMED' && !result && !isCheckinDay(reservation.date) && (
            <Alert tone="info" className="mt-4">
              Esta reserva es para el {formatDate(reservation.date)}: el check-in solo se hace el día del turno.
            </Alert>
          )}
          {reservation.status === 'CONFIRMED' && !result && isCheckinDay(reservation.date) && <CheckinForm key={reservation.reservation_id} reservation={reservation} voucher={voucher} onDone={onCheckedIn} />}
          {reservation.status !== 'CONFIRMED' && !result && (
            <Alert tone="info" className="mt-4">
              Esta reserva está en estado {adminReservationStatusLabel(reservation.status)}: solo una reserva pendiente de asistencia admite el check-in.
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
          {refreshError && (
            <Alert tone="error" className="mt-3">
              {refreshError}
            </Alert>
          )}
        </section>
      )}
    </div>
  );
}
