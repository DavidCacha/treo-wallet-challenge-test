import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import * as api from '../api/endpoints';
import { ApiError, messageFor, NetworkError } from '../api/errors';
import { qk } from '../api/queryKeys';
import type { Transfer } from '../api/types';
import { Money } from '../components/Money';
import { afterTransferCompleted } from './invalidate';
import { useTransferFlow } from './TransferFlow';

/**
 * Un error es recuperable cuando no sabemos si la transferencia se ejecutó
 * (sin respuesta, 5xx, 503 TRY_AGAIN): se reintenta con la MISMA llave y el
 * servidor garantiza que se ejecuta a lo sumo una vez (R4.9, EC-1).
 */
function isRecoverable(e: unknown): boolean {
  return e instanceof NetworkError || (e instanceof ApiError && e.status >= 500);
}

/** R4.14, R4.15: pantalla de confirmación. Envía con la llave del intento. */
export function TransferReviewPage() {
  const { attempt, endAttempt, finishAttempt } = useTransferFlow();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sending = useRef(false);
  // Al terminar se navega al comprobante/OTP; evita que, al borrar el intento,
  // esta pantalla redirija primero al formulario.
  const finished = useRef(false);
  const [rejected, setRejected] = useState<{ message: string } | null>(null);

  const send = useMutation({
    mutationFn: () => {
      if (!attempt) throw new Error('Sin intento activo');
      return api.createTransfer(attempt.draft.payload, attempt.idempotencyKey);
    },
    onSuccess: async ({ data }: { data: Transfer }) => {
      if (data.status === 'COMPLETED') await afterTransferCompleted(queryClient, data);
      else queryClient.setQueryData(qk.transfer(data.id), data);
      finished.current = true;
      finishAttempt();
      navigate(`/transfer/${data.id}/${data.status === 'PENDING_OTP' ? 'otp' : 'receipt'}`, {
        replace: true,
      });
    },
    onError: (e) => {
      if (!isRecoverable(e)) setRejected({ message: messageFor(e) });
    },
    onSettled: () => {
      sending.current = false;
    },
  });

  if (!attempt) return finished.current ? null : <Navigate to="/transfer" replace />;
  const { draft } = attempt;

  const submit = () => {
    // Guardia síncrona además del botón deshabilitado: un doble clic no
    // dispara dos envíos ni siquiera antes de que React vuelva a pintar.
    if (sending.current || rejected) return;
    sending.current = true;
    send.mutate();
  };

  const recoverable = send.isError && isRecoverable(send.error);

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">Confirma la transferencia</h1>
      <div className="card">
        <dl className="details">
          <dt>Monto</dt>
          <dd>
            <Money cents={draft.payload.amount_cents} className="balance" />
          </dd>
          <dt>Desde</dt>
          <dd>{draft.display.sourceName}</dd>
          <dt>Para</dt>
          <dd>
            {draft.display.destinationName}
            <br />
            <span className="muted">{draft.display.destinationDetail}</span>
          </dd>
          <dt>Concepto</dt>
          <dd>{draft.payload.concept}</dd>
          <dt>Referencia</dt>
          <dd>{draft.payload.reference}</dd>
        </dl>
        {draft.display.requiresOtp && (
          <p className="notice">Te pediremos un código de confirmación después de enviar.</p>
        )}
      </div>

      {rejected && (
        <div className="state state-error" role="alert" style={{ marginTop: 16 }}>
          <p className="state-title">La transferencia no se realizó</p>
          <p>{rejected.message}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              endAttempt(); // corregir = nuevo intento = nueva llave
              navigate('/transfer');
            }}
          >
            Corregir datos
          </button>
        </div>
      )}

      {recoverable && (
        <div className="state state-error" role="alert" style={{ marginTop: 16 }}>
          <p className="state-title">No pudimos confirmar el resultado</p>
          <p>
            {messageFor(send.error)} Puedes reintentar sin riesgo: si la transferencia ya se hizo,
            no se repetirá.
          </p>
        </div>
      )}

      {!rejected && (
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={send.isPending}
            aria-disabled={send.isPending}
          >
            {send.isPending ? 'Enviando…' : recoverable ? 'Reintentar envío' : 'Enviar'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={send.isPending}
            onClick={() => {
              endAttempt(); // editar descarta la llave
              navigate('/transfer');
            }}
          >
            Editar
          </button>
        </div>
      )}
    </section>
  );
}
