import 'reflect-metadata';

// Valores de prueba (no son secretos reales). Las URLs se pueden sobreescribir desde el entorno/CI.
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  TEST_DATABASE_URL: 'postgres://treo_app:treo_app_dev@localhost:5432/treo_test',
  TEST_DATABASE_MIGRATION_URL: 'postgres://treo_owner:treo_owner_dev@localhost:5432/treo_test',
  JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef0123456789',
  OTP_PEPPER: 'test-only-otp-pepper-0123456789abcdef0123456789',
  COOKIE_SECURE: 'true',
  AUTH_RATE_LIMIT_MAX: '100000',
};
for (const [k, v] of Object.entries(defaults)) {
  if (process.env[k] === undefined) process.env[k] = v;
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_MIGRATION_URL = process.env.TEST_DATABASE_MIGRATION_URL;
