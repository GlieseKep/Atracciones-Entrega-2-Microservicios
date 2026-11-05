import { currentContext } from './correlation';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const threshold = (): number => {
  if (process.env.LOG_SILENT === 'true') return Number.POSITIVE_INFINITY;
  const level = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
  return ORDER[level] ?? ORDER.info;
};

/** Convierte un error en campos serializables (sin perder el stack para los 5xx). */
export const errorFields = (error: unknown): Record<string, unknown> =>
  error instanceof Error ? { error: error.message, error_name: error.name, stack: error.stack } : { error: String(error) };

/** `an***@correo.com`: los logs nunca llevan el correo completo. */
export function maskEmail(email: unknown): string {
  const [user, domain] = String(email ?? '').split('@');
  return domain ? `${(user ?? '').slice(0, 2)}***@${domain}` : '***';
}

/** `171*****65`: los logs nunca llevan el documento completo. */
export function maskDocument(document: unknown): string {
  const text = String(document ?? '');
  return text.length > 5 ? `${text.slice(0, 3)}${'*'.repeat(text.length - 5)}${text.slice(-2)}` : '***';
}

/**
 * Logger de una línea JSON por evento, con el `correlation_id` de la petición en curso (plan §7.1: aparece en cada log).
 * Los errores van a stderr y el resto a stdout.
 */
export function createLogger(service: string): Logger {
  const write = (level: LogLevel, message: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[level] < threshold()) return;
    const context = currentContext();
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service,
      correlation_id: context?.correlationId ?? null,
      ...(context?.nodeId ? { node_id: context.nodeId } : {}),
      message,
      ...fields,
    });
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}
