import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'beneficiaries' })
export class Beneficiary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  alias: string;

  @Column({ type: 'char', length: 18 })
  clabe: string;

  @Column({ name: 'created_at', type: 'timestamptz', insert: false, update: false })
  createdAt: Date;
}
