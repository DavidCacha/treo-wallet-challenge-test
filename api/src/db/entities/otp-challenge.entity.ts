import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'otp_challenges' })
export class OtpChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'transfer_id', type: 'uuid', unique: true })
  transferId: string;

  /** HMAC-SHA256(OTP_PEPPER, transfer_id:código); el código nunca se guarda en claro. */
  @Column({ name: 'code_hash', type: 'char', length: 64 })
  codeHash: string;

  @Column({ type: 'smallint' })
  attempts: number;

  @Column({ name: 'max_attempts', type: 'smallint' })
  maxAttempts: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', insert: false, update: false })
  createdAt: Date;
}
