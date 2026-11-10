import type { RequestHandler } from 'express';
import { AppError } from '../../lib/problem';
import type { TokenService } from '../../modules/auth/tokens';

/** Exige `Authorization: Bearer <JWT>` válido y coloca req.auth.userId. */
export function authenticate(tokens: TokenService): RequestHandler {
  return (req, _res, next) => {
    const header = req.get('Authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) {
      next(new AppError('UNAUTHORIZED', 401, 'Se requiere autenticación'));
      return;
    }
    try {
      req.auth = tokens.verifyAccess(match[1]!);
      next();
    } catch (err) {
      next(err);
    }
  };
}
