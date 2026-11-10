import 'reflect-metadata';
import { DataSource, type EntityManager } from 'typeorm';
import { User } from './entities/user.entity';
import { Account } from './entities/account.entity';
import { Beneficiary } from './entities/beneficiary.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { AuditEvent } from './entities/audit-event.entity';
import { Transfer } from './entities/transfer.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { OtpChallenge } from './entities/otp-challenge.entity';
import { InitBase1731250000000 } from './migrations/1731250000000-InitBase';
import { Ledger1731250100000 } from './migrations/1731250100000-Ledger';

export const ENTITIES = [
  User,
  Account,
  Beneficiary,
  RefreshToken,
  AuditEvent,
  Transfer,
  LedgerEntry,
  OtpChallenge,
];
export const MIGRATIONS = [InitBase1731250000000, Ledger1731250100000];

export interface DataSourceOptions {
  url: string;
  poolMax?: number;
}

export function createDataSource({ url, poolMax = 20 }: DataSourceOptions): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'typeorm_migrations',
    synchronize: false, // obligatorio: el esquema solo cambia con migraciones
    installExtensions: false, // las extensiones se crean en migraciones, no al conectar
    migrationsRun: false,
    logging: false,
    extra: { max: poolMax, application_name: 'treo-api' },
  });
}

/** Ejecuta `fn` en una transacción READ COMMITTED (design.md §5.2). */
export function inTransaction<T>(ds: DataSource, fn: (m: EntityManager) => Promise<T>): Promise<T> {
  return ds.transaction('READ COMMITTED', fn);
}
