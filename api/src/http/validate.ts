import type { Request } from 'express';
import type { ZodType, ZodTypeDef } from 'zod';
import type { RequestContext } from '../modules/audit/audit.service';

/** Valida con Zod; un ZodError lo traduce problemHandler a 400 VALIDATION_ERROR. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  return schema.parse(data);
}

export function contextOf(req: Request): RequestContext {
  return { requestId: String(req.id), ip: req.ip };
}

/** userId autenticado (lo coloca el middleware authenticate). */
export function userIdOf(req: Request): string {
  const auth = (req as Request & { auth?: { userId: string } }).auth;
  if (!auth) throw new Error('authenticate middleware no aplicado');
  return auth.userId;
}
