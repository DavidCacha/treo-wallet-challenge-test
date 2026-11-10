import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import * as api from '../api/endpoints';
import { qk } from '../api/queryKeys';
import type { Me } from '../api/types';
import { Money } from '../components/Money';
import { EmptyState, ErrorState, LoadingState } from '../components/States';

/** R2.1, R2.4, R2.5, R6.8: cuentas con saldo y límite diario disponible. */
export function DashboardPage() {
  const accounts = useQuery({ queryKey: qk.accounts, queryFn: api.getAccounts });
  const me = useQuery({ queryKey: qk.me, queryFn: api.getMe });

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">Mis cuentas</h1>

      <h2>Límite diario</h2>
      {me.isPending ? (
        <LoadingState label="Cargando límite diario" rows={1} />
      ) : me.isError ? (
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      ) : (
        <DailyLimit me={me.data} />
      )}

      <h2>Cuentas</h2>
      {accounts.isPending ? (
        <LoadingState label="Cargando cuentas" />
      ) : accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : accounts.data.length === 0 ? (
        <EmptyState title="Todavía no tienes cuentas." />
      ) : (
        <ul className="grid list" aria-label="Cuentas">
          {accounts.data.map((a) => (
            <li key={a.id} className="card">
              <h3 className="row" style={{ margin: 0 }}>
                <span>{a.name}</span>
                {a.status !== 'ACTIVE' && <span className="badge">Bloqueada</span>}
              </h3>
              <p className="muted" style={{ margin: '4px 0' }}>
                CLABE {a.clabe}
              </p>
              <p style={{ margin: '8px 0' }}>
                <span className="visually-hidden">Saldo disponible: </span>
                <Money cents={a.available_balance_cents} className="balance" />
              </p>
              <Link to={`/accounts/${a.id}/movements`}>
                Ver movimientos<span className="visually-hidden"> de {a.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="actions">
        <Link to="/transfer" className="btn btn-primary">
          Nueva transferencia
        </Link>
      </div>
    </section>
  );
}

function DailyLimit({ me }: { me: Me }) {
  const available = Math.max(0, me.daily_limit_cents - me.used_today_cents);
  const usedPct =
    me.daily_limit_cents > 0
      ? Math.min(100, Math.round((me.used_today_cents * 100) / me.daily_limit_cents))
      : 100;
  return (
    <div className="card">
      <p style={{ margin: 0 }}>
        Disponible hoy: <Money cents={available} className="balance" />
      </p>
      <div
        className="progress"
        role="progressbar"
        aria-label="Uso del límite diario"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={usedPct}
      >
        <span style={{ width: `${usedPct}%` }} />
      </div>
      <p className="muted" style={{ margin: '6px 0 0' }}>
        Usado <Money cents={me.used_today_cents} /> de <Money cents={me.daily_limit_cents} />. Las
        transferencias a terceros de más de <Money cents={me.otp_threshold_cents} /> piden un código
        de confirmación.
      </p>
    </div>
  );
}
