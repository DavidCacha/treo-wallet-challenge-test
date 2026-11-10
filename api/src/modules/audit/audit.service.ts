import type { EntityManager } from 'typeorm';

/** Contexto de la petición que viaja a los servicios (para auditoría y logs). */
export interface RequestContext {
  requestId: string;
  ip?: string | undefined;
}

export type AuditAction =
  | 'user.registered'
  | 'auth.login_succeeded'
  | 'auth.login_failed'
  | 'auth.refresh_reuse_detected'
  | 'auth.logout'
  | 'beneficiary.created'
  | 'transfer.created'
  | 'transfer.completed'
  | 'transfer.rejected'
  | 'transfer.expired'
  | 'otp.issued'
  | 'otp.failed';

export interface AuditInput {
  action: AuditAction;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Inserta eventos en la tabla de solo inserción. Se llama con el EntityManager de
 * la transacción de negocio para que el evento y la operación se confirmen juntos.
 * Nunca guardar secretos en metadata.
 */
export class AuditService {
  async record(manager: EntityManager, ctx: RequestContext, input: AuditInput): Promise<void> {
    await manager.query(
      `INSERT INTO audit_events (action, actor_user_id, entity_type, entity_id, request_id, ip, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.action,
        input.actorUserId ?? null,
        input.entityType ?? null,
        input.entityId ?? null,
        ctx.requestId,
        ctx.ip ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}
