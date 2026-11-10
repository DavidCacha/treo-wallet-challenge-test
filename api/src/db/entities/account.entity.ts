import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintColumn } from '../transformers';

export type AccountKind = 'USER' | 'SYSTEM';
export type AccountStatus = 'ACTIVE' | 'BLOCKED';

@Entity({ name: 'accounts' })
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'enum', enum: ['USER', 'SYSTEM'], enumName: 'account_kind' })
  kind: AccountKind;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'char', length: 18, unique: true })
  clabe: string;

  @Column({ type: 'char', length: 3, insert: false, update: false })
  currency: 'MXN';

  /** Lo actualiza ÚNICAMENTE el trigger del libro mayor (D-2); la app no tiene UPDATE sobre esta columna. */
  @Column({
    name: 'balance_cents',
    type: 'bigint',
    transformer: bigintColumn,
    insert: false,
    update: false,
  })
  balanceCents: number;

  @Column({ type: 'enum', enum: ['ACTIVE', 'BLOCKED'], enumName: 'account_status' })
  status: AccountStatus;

  @Column({ name: 'created_at', type: 'timestamptz', insert: false, update: false })
  createdAt: Date;
}
