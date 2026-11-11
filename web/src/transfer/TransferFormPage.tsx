import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createTransferSchema, formatCents, parseMxnToCents } from '@treo/shared';
import type { ParseMoneyError } from '@treo/shared';
import * as api from '../api/endpoints';
import { qk } from '../api/queryKeys';
import type { Account, Beneficiary, CreateTransferRequest, Me } from '../api/types';
import { SelectField, TextField } from '../components/Field';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { useTransferFlow } from './TransferFlow';
import type { TransferDraft, TransferFormValues } from './TransferFlow';

const AMOUNT_ERRORS: Record<ParseMoneyError, string> = {
  EMPTY: 'Requerido',
  INVALID_FORMAT: 'Escribe un monto como 1,234.56',
  TOO_MANY_DECIMALS: 'Máximo 2 decimales',
  OUT_OF_RANGE: 'El monto excede el máximo por transferencia',
};

/** Referencia numérica de 7 dígitos generada al azar (el usuario puede cambiarla). */
export function generateReference(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return String(1_000_000 + ((n ?? 0) % 9_000_000));
}

type Errors = Partial<Record<keyof TransferFormValues, string>>;

const FIELD_OF: Record<string, keyof TransferFormValues> = {
  source_account_id: 'source_account_id',
  beneficiary_id: 'destination',
  destination_account_id: 'destination',
  amount_cents: 'amount',
  concept: 'concept',
  reference: 'reference',
};

/** Convierte lo capturado en el cuerpo de la API validándolo con createTransferSchema (compartido). */
export function validateTransfer(
  v: TransferFormValues,
): { ok: true; payload: CreateTransferRequest } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const money = parseMxnToCents(v.amount);
  if (!money.ok) errors.amount = AMOUNT_ERRORS[money.error];
  if (!v.source_account_id) errors.source_account_id = 'Elige la cuenta de origen';
  if (!v.destination) errors.destination = 'Elige a quién transferir';

  const [kind, id] = v.destination.split(':');
  const candidate = {
    source_account_id: v.source_account_id,
    ...(kind === 'b' ? { beneficiary_id: id } : kind === 'a' ? { destination_account_id: id } : {}),
    amount_cents: money.ok ? money.cents : 1,
    concept: v.concept,
    reference: v.reference.trim(),
  };
  const parsed = createTransferSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = FIELD_OF[String(issue.path[0])];
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }
  if (v.destination === `a:${v.source_account_id}` && !errors.destination) {
    errors.destination = 'Elige una cuenta distinta a la de origen';
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, payload: parsed.data };
}

/** R4.15 (formulario), R6.8 (aviso de código), R4.3/EC-3 (montos sin redondeo). */
export function TransferFormPage() {
  const accounts = useQuery({ queryKey: qk.accounts, queryFn: api.getAccounts });
  const beneficiaries = useQuery({ queryKey: qk.beneficiaries, queryFn: api.getBeneficiaries });
  const me = useQuery({ queryKey: qk.me, queryFn: api.getMe });

  const queries = [accounts, beneficiaries, me];
  const failed = queries.find((q) => q.isError);

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">Transferir</h1>
      {failed ? (
        <ErrorState
          error={failed.error}
          onRetry={() => queries.forEach((q) => q.isError && void q.refetch())}
        />
      ) : accounts.data && beneficiaries.data && me.data ? (
        <TransferForm accounts={accounts.data} beneficiaries={beneficiaries.data} me={me.data} />
      ) : (
        <LoadingState label="Cargando datos para transferir" />
      )}
    </section>
  );
}

function TransferForm({
  accounts,
  beneficiaries,
  me,
}: {
  accounts: Account[];
  beneficiaries: Beneficiary[];
  me: Me;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { lastValues, startAttempt } = useTransferFlow();
  const active = accounts.filter((a) => a.status === 'ACTIVE');

  const initial = useMemo<TransferFormValues>(() => {
    if (lastValues) return lastValues;
    const pre = params.get('beneficiary');
    return {
      source_account_id: active[0]?.id ?? '',
      destination: pre && beneficiaries.some((b) => b.id === pre) ? `b:${pre}` : '',
      amount: '',
      concept: '',
      reference: generateReference(),
    };
    // Solo al montar: después manda lo que escriba el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [values, setValues] = useState<TransferFormValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = (field: keyof TransferFormValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  if (active.length === 0) {
    return <EmptyState title="No tienes cuentas activas para transferir." />;
  }
  const ownTargets = active.filter((a) => a.id !== values.source_account_id);
  if (beneficiaries.length === 0 && ownTargets.length === 0) {
    return (
      <EmptyState title="Todavía no tienes a quién transferir.">
        <Link to="/beneficiaries" className="btn btn-primary">
          Agregar beneficiario
        </Link>
      </EmptyState>
    );
  }

  const source = active.find((a) => a.id === values.source_account_id);
  const money = parseMxnToCents(values.amount);
  const isP2P = values.destination.startsWith('b:');
  const requiresOtp = isP2P && money.ok && money.cents > me.otp_threshold_cents;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateTransfer(values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = Object.keys(result.errors)[0];
      if (first) document.getElementById(`transfer-${first}`)?.focus();
      return;
    }
    setErrors({});
    const [kind, id] = values.destination.split(':');
    const ben = kind === 'b' ? beneficiaries.find((b) => b.id === id) : undefined;
    const acc = kind === 'a' ? active.find((a) => a.id === id) : undefined;
    const draft: TransferDraft = {
      values,
      payload: result.payload,
      display: {
        sourceName: source?.name ?? '',
        destinationName: ben ? `${ben.alias} (${ben.name})` : (acc?.name ?? ''),
        destinationDetail: `CLABE ${(ben?.clabe ?? acc?.clabe ?? '').slice(-4).padStart(18, '•')}`,
        requiresOtp,
      },
    };
    startAttempt(draft); // genera la Idempotency-Key de este intento
    navigate('/transfer/review');
  };

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Datos de la transferencia" className="card">
      <SelectField
        id="transfer-source_account_id"
        label="Cuenta de origen"
        value={values.source_account_id}
        onChange={set('source_account_id')}
        error={errors.source_account_id}
        hint={
          source ? <>Saldo disponible: {formatCents(source.available_balance_cents)}</> : undefined
        }
      >
        {active.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        id="transfer-destination"
        label="Destino"
        value={values.destination}
        onChange={set('destination')}
        error={errors.destination}
      >
        <option value="">Elige un destino</option>
        {beneficiaries.length > 0 && (
          <optgroup label="Beneficiarios">
            {beneficiaries.map((b) => (
              <option key={b.id} value={`b:${b.id}`}>
                {b.alias} · {b.name}
              </option>
            ))}
          </optgroup>
        )}
        {ownTargets.length > 0 && (
          <optgroup label="Mis cuentas">
            {ownTargets.map((a) => (
              <option key={a.id} value={`a:${a.id}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
        )}
      </SelectField>

      <TextField
        id="transfer-amount"
        label="Monto (MXN)"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={values.amount}
        onChange={set('amount')}
        error={errors.amount}
        hint={
          isP2P
            ? `Disponible hoy para terceros: ${formatCents(Math.max(0, me.daily_limit_cents - me.used_today_cents))}`
            : undefined
        }
      />
      {requiresOtp && (
        <p className="notice" role="status">
          Requerirá un código de confirmación: supera {formatCents(me.otp_threshold_cents)}.
        </p>
      )}

      <TextField
        id="transfer-concept"
        label="Concepto"
        maxLength={40}
        autoComplete="off"
        value={values.concept}
        onChange={set('concept')}
        placeholder="Pago de la tanda"
        error={errors.concept}
      />
      <TextField
        id="transfer-reference"
        label="Referencia numérica"
        inputMode="numeric"
        maxLength={7}
        autoComplete="off"
        hint="Se genera automáticamente; puedes cambiarla (de 1 a 7 dígitos)."
        value={values.reference}
        onChange={set('reference')}
        error={errors.reference}
      />
      <div>
        <button
          type="button"
          className="btn btn-link"
          onClick={() => setValues((v) => ({ ...v, reference: generateReference() }))}
        >
          Generar otra referencia
        </button>
      </div>

      <div className="actions">
        <button type="submit" className="btn btn-primary">
          Continuar
        </button>
      </div>
    </form>
  );
}
