import type { EntityManager } from 'typeorm';

/**
 * Suma de transferencias a terceros COMPLETADAS en el día de negocio (R6.1, R6.2).
 *
 * La ventana [inicio, fin) se calcula EN SQL a partir de la misma referencia que se
 * guarda como completed_at (por defecto now(), el instante de la transacción), en la
 * zona IANA configurada. Así el día del límite y la fecha registrada nunca difieren,
 * aunque la transacción espere un bloqueo al cruzar la medianoche (EC-4).
 * `at` solo se usa en pruebas para fijar el "ahora".
 */
export async function usedTodayCents(
  m: EntityManager,
  userId: string,
  timezone: string,
  at?: Date,
): Promise<number> {
  const rows: Array<{ used: string }> = await m.query(
    `WITH ref AS (SELECT COALESCE($3::timestamptz, now()) AS t),
          win AS (
            SELECT (date_trunc('day', ref.t AT TIME ZONE $2) AT TIME ZONE $2) AS start_at,
                   ((date_trunc('day', ref.t AT TIME ZONE $2) + interval '1 day') AT TIME ZONE $2) AS end_at
              FROM ref
          )
     SELECT COALESCE(SUM(t.amount_cents), 0)::text AS used
       FROM transfers t, win
      WHERE t.user_id = $1
        AND t.status = 'COMPLETED'
        AND t.counts_toward_limit
        AND t.completed_at >= win.start_at
        AND t.completed_at < win.end_at`,
    [userId, timezone, at ?? null],
  );
  const used = Number(rows[0]?.used ?? '0');
  if (!Number.isSafeInteger(used)) throw new RangeError('Suma diaria fuera de rango');
  return used;
}
