import pino, { type Logger } from 'pino';

/** Enmascara una CLABE dejando visibles solo los últimos 4 dígitos. */
function maskForLog(value: unknown): string {
  const s = String(value ?? '');
  return s.length > 4 ? `${'*'.repeat(s.length - 4)}${s.slice(-4)}` : '****';
}

/** Rutas que nunca deben llegar a los logs (NFR-6). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'refresh_token',
  '*.refresh_token',
  'access_token',
  '*.access_token',
  'code',
  '*.code',
  'otp',
  '*.otp',
  'dev_otp_code',
  '*.dev_otp_code',
  'token',
  '*.token',
  'clabe',
  '*.clabe',
  '*.*.clabe',
];

export function createLogger(level: string, destination?: pino.DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: 'treo-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: REDACT_PATHS,
        censor: (value, path) =>
          path[path.length - 1] === 'clabe' ? maskForLog(value) : '[REDACTED]',
      },
    },
    destination,
  );
}
