import { useState } from 'react';
import type { FormEvent } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { movementsQuerySchema, movementTypeSchema } from '@treo/shared';
import type { MovementType } from '@treo/shared';
import * as api from '../api/endpoints';
import type { MovementFilters } from '../api/endpoints';
import { qk } from '../api/queryKeys';
import type { Movement } from '../api/types';
import { SelectField, TextField } from '../components/Field';
import { Money } from '../components/Money';
import { EmptyState, ErrorState, FormAlert, LoadingState } from '../components/States';
import { formatDateTime, movementLabel } from '../lib/format';

const PAGE_SIZE = 20;

/** Lee los filtros de la URL; los valores no válidos se ignoran. */
function filtersFrom(params: URLSearchParams): MovementFilters {
  const type = movementTypeSchema.safeParse(params.get('type'));
  const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    from: date(params.get('from')),
    to: date(params.get('to')),
    type: type.success ? type.data : undefined,
  };
}

/** R5.3, R5.8: filtros por fecha y tipo reflejados en la URL y "Cargar más" por cursor. */
export function MovementsPage() {
  const { accountId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const filters = filtersFrom(params);

  const accounts = useQuery({ queryKey: qk.accounts, queryFn: api.getAccounts });
  const account = accounts.data?.find((a) => a.id === accountId);

  const movements = useInfiniteQuery({
    queryKey: qk.movements(accountId, filters),
    queryFn: ({ pageParam }) => api.getMovements(accountId, filters, pageParam, PAGE_SIZE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: accountId !== '',
  });

  const items: Movement[] = movements.data?.pages.flatMap((p) => p.data) ?? [];
  const hasFilters = Boolean(filters.from || filters.to || filters.type);

  return (
    <section aria-labelledby="page-title">
      <p>
        <Link to="/">← Mis cuentas</Link>
      </p>
      <h1 id="page-title">Movimientos{account ? ` · ${account.name}` : ''}</h1>
      {account && (
        <p className="muted">
          Saldo disponible: <Money cents={account.available_balance_cents} />
        </p>
      )}

      <Filters
        key={params.toString()}
        initial={filters}
        onApply={(next) => {
          const p = new URLSearchParams();
          if (next.from) p.set('from', next.from);
          if (next.to) p.set('to', next.to);
          if (next.type) p.set('type', next.type);
          setParams(p);
        }}
      />

      {movements.isPending ? (
        <LoadingState label="Cargando movimientos" />
      ) : movements.isError ? (
        <ErrorState error={movements.error} onRetry={() => void movements.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={
            hasFilters ? 'Sin movimientos en este rango.' : 'Esta cuenta aún no tiene movimientos.'
          }
        />
      ) : (
        <>
          <ul className="list" aria-label="Movimientos">
            {items.map((m) => (
              <MovementRow key={m.id} m={m} />
            ))}
          </ul>
          <div className="actions" aria-live="polite">
            {movements.isFetchNextPageError && (
              <FormAlert>No pudimos cargar más movimientos. Intenta de nuevo.</FormAlert>
            )}
            {movements.hasNextPage ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void movements.fetchNextPage()}
                disabled={movements.isFetchingNextPage}
              >
                {movements.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
              </button>
            ) : (
              <p className="muted">No hay más movimientos.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function MovementRow({ m }: { m: Movement }) {
  return (
    <li className="card">
      <div className="row">
        <strong>{movementLabel(m.type)}</strong>
        <Money cents={m.amount_cents} className={m.amount_cents < 0 ? 'negative' : 'positive'} />
      </div>
      <div className="row muted">
        <span>
          {m.concept ?? '—'}
          {m.reference ? ` · Ref. ${m.reference}` : ''}
          {m.counterparty
            ? ` · ${m.counterparty.display_name} ${m.counterparty.clabe_masked.slice(-8)}`
            : ''}
        </span>
        <span>
          Saldo: <Money cents={m.balance_after_cents} />
        </span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        <time dateTime={m.created_at}>{formatDateTime(m.created_at)}</time>
      </p>
    </li>
  );
}

function Filters({
  initial,
  onApply,
}: {
  initial: MovementFilters;
  onApply: (f: MovementFilters) => void;
}) {
  const [from, setFrom] = useState(initial.from ?? '');
  const [to, setTo] = useState(initial.to ?? '');
  const [type, setType] = useState<string>(initial.type ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const candidate = {
      from: from || undefined,
      to: to || undefined,
      type: (type || undefined) as MovementType | undefined,
    };
    // Mismas reglas que la API (from ≤ to, fechas válidas).
    const parsed = movementsQuerySchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Filtros inválidos');
      return;
    }
    setError(null);
    onApply(candidate);
  };

  return (
    <form onSubmit={submit} aria-label="Filtros" className="card" style={{ marginBottom: 16 }}>
      <FormAlert>{error}</FormAlert>
      <div className="filters">
        <TextField
          label="Desde"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField label="Hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <SelectField label="Tipo" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos</option>
          <option value="TRANSFER_IN">Recibidas</option>
          <option value="TRANSFER_OUT">Enviadas</option>
          <option value="DEPOSIT">Depósitos</option>
        </SelectField>
        <div className="field">
          <button type="submit" className="btn btn-primary">
            Aplicar filtros
          </button>
        </div>
        <div className="field">
          <button
            type="button"
            className="btn btn-link"
            onClick={() => {
              setFrom('');
              setTo('');
              setType('');
              setError(null);
              onApply({});
            }}
          >
            Limpiar
          </button>
        </div>
      </div>
    </form>
  );
}
