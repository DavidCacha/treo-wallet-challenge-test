import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { confirmTransferSchema } from '@treo/shared';
import * as api from '../api/endpoints';
import { isApiError, messageFor } from '../api/errors';
import { qk } from '../api/queryKeys';
import { TextField } from '../components/Field';
import { Money } from '../components/Money';
import { ErrorState, FormAlert, LoadingState } from '../components/States';
import { formatDateTime } from '../lib/format';
import { afterTransferCompleted } from './invalidate';

/** R6.3–R6.6: confirmación con código de un solo uso. */
export function TransferOtpPage() {
  const { transferId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const transfer = useQuery({
    queryKey: qk.transfer(transferId),
    queryFn: () => api.getTransfer(transferId),
  });
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);

  const confirm = useMutation({
    mutationFn: (c: string) => api.confirmTransfer(transferId, c),
    onSuccess: async (t) => {
      if (t.status === 'COMPLETED') await afterTransferCompleted(queryClient, t);
      else queryClient.setQueryData(qk.transfer(t.id), t);
      navigate(`/transfer/${t.id}/receipt`, { replace: true });
    },
    onError: async (e) => {
      if (isApiError(e, 'OTP_INVALID')) {
        const left = e.problem?.attempts_remaining;
        setAttemptsLeft(typeof left === 'number' ? left : null);
        setFieldError(
          typeof left === 'number'
            ? `El código no es correcto. Te ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}.`
            : messageFor(e),
        );
        setCode('');
      } else if (isApiError(e, 'OTP_EXPIRED')) {
        setExpired(true);
        await queryClient.invalidateQueries({ queryKey: qk.transfer(transferId) });
      } else if (isApiError(e, 'TRANSFER_NOT_PENDING')) {
        await queryClient.invalidateQueries({ queryKey: qk.transfer(transferId) });
        navigate(`/transfer/${transferId}/receipt`, { replace: true });
      }
    },
  });

  if (transfer.isPending) return <LoadingState label="Cargando transferencia" />;
  if (transfer.isError) {
    return <ErrorState error={transfer.error} onRetry={() => void transfer.refetch()} />;
  }
  const t = transfer.data;
  if (t.status !== 'PENDING_OTP' && !expired) {
    return <Navigate to={`/transfer/${t.id}/receipt`} replace />;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (confirm.isPending) return;
    const parsed = confirmTransferSchema.safeParse({ code: code.trim() });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Código inválido');
      return;
    }
    setFieldError(null);
    confirm.mutate(parsed.data.code);
  };

  if (expired) {
    return (
      <section aria-labelledby="page-title">
        <h1 id="page-title">Código expirado</h1>
        <div className="state state-error" role="alert">
          <p className="state-title">La transferencia no se realizó</p>
          <p>{messageFor(confirm.error)}</p>
          <Link to="/transfer" className="btn btn-primary">
            Nueva transferencia
          </Link>
        </div>
      </section>
    );
  }

  const left = attemptsLeft ?? t.challenge?.attempts_remaining;
  const otherError =
    confirm.isError && !isApiError(confirm.error, 'OTP_INVALID') ? messageFor(confirm.error) : null;

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">Código de confirmación</h1>
      <p>
        Para enviar <Money cents={t.amount_cents} /> a {t.destination.display_name} escribe el
        código de 6 dígitos.
      </p>
      {t.challenge && (
        <p className="muted">
          Vence {formatDateTime(t.challenge.expires_at)}
          {typeof left === 'number' ? ` · Intentos restantes: ${left}` : ''}
        </p>
      )}
      {t.challenge?.dev_otp_code && (
        <p className="notice">
          Entorno de desarrollo: el código simulado es <strong>{t.challenge.dev_otp_code}</strong>.
        </p>
      )}
      <form onSubmit={submit} noValidate aria-label="Código de confirmación" className="card">
        <FormAlert>{otherError}</FormAlert>
        <TextField
          label="Código"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={fieldError ?? undefined}
        />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={confirm.isPending}>
            {confirm.isPending ? 'Confirmando…' : 'Confirmar'}
          </button>
        </div>
      </form>
    </section>
  );
}
