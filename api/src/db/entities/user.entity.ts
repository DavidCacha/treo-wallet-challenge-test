import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintColumn } from '../transformers';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'citext', unique: true })
  email: string;

  @Column({ name: 'full_name', type: 'text' })
  fullName: string;

  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash: string;

  @Column({ name: 'daily_limit_cents', type: 'bigint', transformer: bigintColumn })
  dailyLimitCents: number;

  @Column({ name: 'created_at', type: 'timestamptz', insert: false, update: false })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', insert: false })
  updatedAt: Date;
}
