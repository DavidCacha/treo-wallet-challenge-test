import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true');

const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveInt.default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  DATABASE_MIGRATION_URL: z.string().url().optional(),
  DB_POOL_MAX: positiveInt.default(20),
  LOCK_TIMEOUT_MS: positiveInt.default(5000),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_ISSUER: z.string().min(1).default('treo-wallet-api'),
  JWT_AUDIENCE: z.string().min(1).default('treo-wallet-clients'),
  ACCESS_TOKEN_TTL_SECONDS: positiveInt.default(900),
  REFRESH_TOKEN_TTL_DAYS: positiveInt.default(7),
  COOKIE_SECURE: bool,

  OTP_PEPPER: z.string().min(32, 'OTP_PEPPER debe tener al menos 32 caracteres'),
  DEFAULT_DAILY_LIMIT_CENTS: positiveInt.default(5_000_000),
  OTP_THRESHOLD_CENTS: positiveInt.default(1_000_000),
  OTP_TTL_SECONDS: positiveInt.default(300),
  OTP_MAX_ATTEMPTS: positiveInt.max(10).default(3),
  BUSINESS_TIMEZONE: z
    .string()
    .default('America/Mexico_City')
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Zona horaria IANA inválida'),
  CLABE_PREFIX: z
    .string()
    .regex(/^\d{6}$/, 'CLABE_PREFIX: 3 dígitos de banco + 3 de plaza')
    .default('999180'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  LOGIN_RATE_LIMIT_MAX: positiveInt.default(5),
  LOGIN_RATE_LIMIT_WINDOW_MS: positiveInt.default(900_000),
  AUTH_RATE_LIMIT_MAX: positiveInt.default(30),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${issues}`);
  }
  return parsed.data;
}
