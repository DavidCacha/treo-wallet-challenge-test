import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintColumn } from '../transformers';

export type EntryType = 'TRANSFER_IN' | 'TRANSFER_OUT' | 'DEPOSIT';

/** Asiento contable inmutable. balance_after_cents lo calcula el trigger. */
@Entity({ name: 'ledger_entries' })
export class LedgerEntry {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id: string;

  @Column({ name: 'transfer_id', type: 'uuid' })
  transferId: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({
    name: 'entry_type',
    type: 'enum',
    enum: ['TRANSFER_IN', 'TRANSFER_OUT', 'DEPOSIT'],
    enumName: 'entry_type',
  })
  entryType: EntryType;

  @Column({ name: 'amount_cents', type: 'bigint', transformer: bigintColumn })
  amountCents: number;

  @Column({
    name: 'balance_after_cents',
    type: 'bigint',
    transformer: bigintColumn,
    insert: false,
    update: false,
  })
  balanceAfterCents: number;

  @Column({ name: 'created_at', type: 'timestamptz', insert: false, update: false })
  createdAt: Date;
}
