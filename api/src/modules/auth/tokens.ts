import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import type { AppConfig } from '../../config/env';
import { AppError } from '../../lib/problem';

export interface AccessTokenClaims {
  userId: string;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Refresh token opaco de 256 bits; solo su sha256 se guarda en la base. */
export function newRefreshTokenValue(): string {
  return randomBytes(32).toString('base64url');
}

export class TokenService {
  constructor(private readonly config: AppConfig) {}

  get accessTtlSeconds(): number {
    return this.config.ACCESS_TOKEN_TTL_SECONDS;
  }

  refreshExpiry(from = new Date()): Date {
    return new Date(from.getTime() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  signAccess(userId: string): string {
    return jwt.sign({}, this.config.JWT_SECRET, {
      algorithm: 'HS256',
      subject: userId,
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
      issuer: this.config.JWT_ISSUER,
      audience: this.config.JWT_AUDIENCE,
      jwtid: randomUUID(),
    });
  }

  verifyAccess(token: string): AccessTokenClaims {
    try {
      const payload = jwt.verify(token, this.config.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_AUDIENCE,
      });
      if (typeof payload === 'string' || typeof payload.sub !== 'string') {
        throw new AppError('UNAUTHORIZED', 401, 'Token inválido');
      }
      return { userId: payload.sub };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof TokenExpiredError) {
        throw new AppError('TOKEN_EXPIRED', 401, 'El token de acceso expiró');
      }
      throw new AppError('UNAUTHORIZED', 401, 'Token inválido');
    }
  }
}
