import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Solo inserción: UPDATE/DELETE/TRUNCATE están revocados y bloqueados por trigger (NFR-4). */
@Entity({ name: 'audit_events' })
export class AuditEvent {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: string;

  @Column({ name: 'occurred_at', type: 'timestamptz', insert: false, update: false })
  occurredAt: Date;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'text' })
  action: string;

  @Column({ name: 'entity_type', type: 'text', nullable: true })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'text', nullable: true })
  entityId: string | null;

  @Column({ name: 'request_id', type: 'text', nullable: true })
  requestId: string | null;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Column({ type: 'jsonb' })
  metadata: Record<string, unknown>;
}
