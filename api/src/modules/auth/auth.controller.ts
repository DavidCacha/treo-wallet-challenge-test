import { Router, type Response } from 'express';
import { clientPlatformSchema, loginSchema, registerSchema } from '@treo/shared';
import type { AppConfig } from '../../config/env';
import { contextOf, parse } from '../../http/validate';
import { authRateLimiter, loginRateLimiter } from '../../http/rate-limit';
import { AppError } from '../../lib/problem';
import type { AuthService, IssuedTokens } from './auth.service';

export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function platformOf(header: unknown): 'web' | 'mobile' {
  const parsed = clientPlatformSchema.safeParse(header);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'Encabezado X-Client-Platform requerido: web | mobile',
    );
  }
  return parsed.data;
}

/**
 * Web: refresh token en cookie HttpOnly; SameSite=Strict; nunca en el cuerpo (R1.10).
 * Móvil: refresh token en el cuerpo para guardarlo en SecureStore (R1.11).
 */
export function sendTokens(
  res: Response,
  config: AppConfig,
  platform: 'web' | 'mobile',
  t: IssuedTokens,
) {
  const body: Record<string, unknown> = {
    access_token: t.accessToken,
    token_type: 'Bearer',
    expires_in: t.expiresIn,
  };
  if (platform === 'web') {
    res.cookie(REFRESH_COOKIE, t.refreshToken, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    });
  } else {
    body.refresh_token = t.refreshToken;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(body);
}

export function authRouter(auth: AuthService, config: AppConfig): Router {
  const r = Router();
  r.use('/auth', authRateLimiter(config));

  r.post('/auth/register', async (req, res) => {
    const input = parse(registerSchema, req.body);
    const user = await auth.register(input, contextOf(req));
    res.status(201).json(user);
  });

  r.post('/auth/login', loginRateLimiter(config), async (req, res) => {
    const platform = platformOf(req.get('X-Client-Platform'));
    const input = parse(loginSchema, req.body);
    const tokens = await auth.login(input, contextOf(req));
    sendTokens(res, config, platform, tokens);
  });

  return r;
}
