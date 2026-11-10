import { randomInt } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { buildClabe } from '@treo/shared';
import { Account } from '../../db/entities/account.entity';

/** Genera una CLABE interna válida y libre (prefijo de banco/plaza configurable). */
export async function generateUniqueClabe(
  manager: EntityManager,
  prefix6: string,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const account11 = String(randomInt(0, 1e11)).padStart(11, '0');
    const clabe = buildClabe(prefix6, account11);
    const exists = await manager.existsBy(Account, { clabe });
    if (!exists) return clabe;
  }
  throw new Error('No se pudo generar una CLABE única');
}
