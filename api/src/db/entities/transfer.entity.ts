import { Column, Entity, PrimaryColumn } from 'typeorm';
import { bigintColumn } from '../transformers';

export type TransferKind = 'P2P' | 'OWN_ACCOUNTS' | 'DEPOSIT';
export type TransferStatus = 'PENDING_OTP' | 'COMPLETED' | 'REJECTED' | 'EXPIRED';

@Entity({ name: 'transfers' })
export class Transfer {
  /** Se genera en la app (randomUUID) para poder derivar el hash del OTP antes de insertar. */
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'idempotency_key', type: 'uuid', nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'request_hash', type: 'char', length: 64, nullable: true })
  requestHash: string | null;

  @Column({ type: 'enum', enum: ['P2P', 'OWN_ACCOUNTS', 'DEPOSIT'], enumName: 'transfer_kind' })
  kind: TransferKind;

  @Column({ name: 'source_account_id', type: 'uuid' })
  sourceAccountId: string;

  @Column({ name: 'destination_account_id', type: 'uuid' })
  destinationAccountId: string;

  @Column({ name: 'beneficiary_id', type: 'uuid', nullable: true })
  beneficiaryId: string | null;

  @Column({ name: 'amount_cents', type: 'bigint', transformer: bigintColumn })
  amountCents: number;

  @Column({ type: 'varchar', length: 40 })
  concept: string;

  @Column({ type: 'varchar', length: 7 })
  reference: string;

  @Column({
    type: 'enum',
    enum: ['PENDING_OTP', 'COMPLETED', 'REJECTED', 'EXPIRED'],
    enumName: 'transfer_status',
  })
  status: TransferStatus;

  @Column({ name: 'rejection_code', type: 'text', nullable: true })
  rejectionCode: string | null;

  @Column({ name: 'tracking_code', type: 'text', unique: true })
  trackingCode: string;

  @Column({ name: 'counts_toward_limit', type: 'boolean' })
  countsTowardLimit: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', insert: false, update: false })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
