import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import * as api from '../api/endpoints';
import { ApiError, messageFor } from '../api/errors';
import { qk } from '../api/queryKeys';
import { Money } from '../components/Money';
import { ErrorState, LoadingState } from '../components/States';
import { formatDateTime, transferStatusLabel } from '../lib/format';

const TITLES: Record<string, string> = {
  COMPLETED: 'Transferencia completada',
  PENDING_OTP: 'Transferencia pendiente de código',
  REJECTED: 'Transferencia rechazada',
  EXPIRED: 'Transferencia expirada',
};

/** R4.11: comprobante con folio, montos, contraparte enmascarada y fechas. */
export function TransferReceiptPage() {
  const { transferId = '' } = useParams();
  const transfer = useQuery({
    queryKey: qk.transfer(transferId),
    queryFn: () => api.getTransfer(transferId),
  });
  const accounts = useQuery({ queryKey: qk.accounts, queryFn: api.getAccounts });

  if (transfer.isPending) return <LoadingState label="Cargando comprobante" />;
  if (transfer.isError) {
    return <ErrorState error={transfer.error} onRetry={() => void transfer.refetch()} />;
  }
  const t = transfer.data;
  const source = accounts.data?.find((a) => a.id === t.source_account_id);

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">{TITLES[t.status] ?? 'Transferencia'}</h1>
      <div className="card" aria-label="Comprobante">
        <p className="row" style={{ marginTop: 0 }}>
          <Money cents={t.amount_cents} className="balance" />
          <span className={`badge badge-${t.status}`}>{transferStatusLabel(t.status)}</span>
        </p>
        {t.rejection_code && (
          <p className="negative" role="status">
            {messageFor(
              new ApiError(422, {
                code: t.rejection_code,
                type: '',
                title: '',
                status: 422,
                request_id: '',
              }),
            )}
          </p>
        )}
        <dl className="details">
          <dt>Folio de rastreo</dt>
          <dd>{t.tracking_code}</dd>
          <dt>Desde</dt>
          <dd>{source?.name ?? 'Cuenta propia'}</dd>
          <dt>Para</dt>
          <dd>
            {t.destination.display_name}
            <br />
            <span className="muted">CLABE {t.destination.clabe_masked}</span>
          </dd>
          <dt>Concepto</dt>
          <dd>{t.concept}</dd>
          <dt>Referencia</dt>
          <dd>{t.reference}</dd>
          <dt>Tipo</dt>
          <dd>{t.kind === 'P2P' ? 'A tercero' : 'Entre mis cuentas'}</dd>
          <dt>Creada</dt>
          <dd>
            <time dateTime={t.created_at}>{formatDateTime(t.created_at)}</time>
          </dd>
          {t.completed_at && (
            <>
              <dt>Completada</dt>
              <dd>
                <time dateTime={t.completed_at}>{formatDateTime(t.completed_at)}</time>
              </dd>
            </>
          )}
          <dt>ID</dt>
          <dd className="muted">{t.id}</dd>
        </dl>
      </div>
      <div className="actions">
        {t.status === 'PENDING_OTP' && (
          <Link to={`/transfer/${t.id}/otp`} className="btn btn-primary">
            Escribir código
          </Link>
        )}
        <Link to="/transfer" className="btn btn-primary">
          Nueva transferencia
        </Link>
        <Link to="/" className="btn btn-secondary">
          Ir a mis cuentas
        </Link>
        <button type="button" className="btn btn-link" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>
    </section>
  );
}
