import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { CreateBeneficiaryInput } from '@treo/shared';
import * as api from '../api/endpoints';
import { isApiError, messageFor } from '../api/errors';
import { qk } from '../api/queryKeys';
import { TextField } from '../components/Field';
import { EmptyState, ErrorState, FormAlert, LoadingState } from '../components/States';
import { createBeneficiarySchema, isValidClabe, maskClabe } from '@treo/shared';

/** Errores de negocio de la API que pertenecen al campo CLABE. */
const CLABE_ERRORS = new Set([
  'BENEFICIARY_ALREADY_EXISTS',
  'INVALID_CLABE_CHECK_DIGIT',
  'CLABE_NOT_FOUND',
  'BENEFICIARY_IS_OWN_ACCOUNT',
]);

/**
 * El formulario usa createBeneficiarySchema + isValidClabe de @treo/shared:
 * la misma regla del dígito verificador que aplica la API (R3.7).
 */
const formSchema = createBeneficiarySchema.refine((v) => isValidClabe(v.clabe), {
  path: ['clabe'],
  message: 'El dígito verificador de la CLABE no es válido.',
});

/** Mensaje en vivo mientras se escribe la CLABE. */
function clabeHint(value: string): string {
  if (value === '') return '18 dígitos.';
  if (!/^\d*$/.test(value)) return 'Solo dígitos.';
  if (value.length < 18) return `${value.length} de 18 dígitos.`;
  if (value.length > 18) return 'Tiene más de 18 dígitos.';
  return isValidClabe(value) ? 'Dígito verificador correcto.' : 'Dígito verificador incorrecto.';
}

export function BeneficiariesPage() {
  const list = useQuery({ queryKey: qk.beneficiaries, queryFn: api.getBeneficiaries });
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">Beneficiarios</h1>
      {created && (
        <p className="notice" role="status">
          Se agregó a {created}.
        </p>
      )}

      {showForm ? (
        <BeneficiaryForm
          onCancel={() => setShowForm(false)}
          onCreated={(alias) => {
            setCreated(alias);
            setShowForm(false);
          }}
        />
      ) : (
        <div className="actions" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setCreated(null);
              setShowForm(true);
            }}
          >
            Agregar beneficiario
          </button>
        </div>
      )}

      {list.isPending ? (
        <LoadingState label="Cargando beneficiarios" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState title="Aún no tienes beneficiarios.">
          <p>Agrega uno con su CLABE para poder transferirle.</p>
        </EmptyState>
      ) : (
        <ul className="list" aria-label="Beneficiarios">
          {list.data.map((b) => (
            <li key={b.id} className="card row">
              <span>
                <strong>{b.alias}</strong> <span className="muted">· {b.name}</span>
                <br />
                <span className="muted">CLABE {maskClabe(b.clabe)}</span>
              </span>
              <Link to={`/transfer?beneficiary=${b.id}`}>
                Transferir<span className="visually-hidden"> a {b.alias}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BeneficiaryForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (alias: string) => void;
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<CreateBeneficiaryInput>({
    resolver: zodResolver(formSchema),
    mode: 'onTouched',
    defaultValues: { name: '', alias: '', clabe: '' },
  });
  const clabe = watch('clabe');

  const create = useMutation({
    mutationFn: api.createBeneficiary,
    onSuccess: async (b) => {
      await queryClient.invalidateQueries({ queryKey: qk.beneficiaries });
      onCreated(b.alias);
    },
    onError: (e) => {
      if (isApiError(e) && CLABE_ERRORS.has(e.code)) {
        setError('clabe', { message: messageFor(e) }, { shouldFocus: true });
      } else {
        setFormError(messageFor(e));
      }
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    create.mutate(values);
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Nuevo beneficiario" className="card">
      <h2 style={{ marginTop: 0 }}>Nuevo beneficiario</h2>
      <FormAlert>{formError}</FormAlert>
      <TextField
        label="Nombre"
        placeholder='Nombre completo'
        autoComplete="off"
        error={errors.name?.message}
        {...register('name')}
      />
      <TextField
        label="Alias"
        autoComplete="off"
        placeholder='Mi mejor amigo'
        hint="Máximo 30 caracteres. Así lo verás al transferir."
        error={errors.alias?.message}
        {...register('alias')}
      />
      <TextField
        label="CLABE"
        inputMode="numeric"
        autoComplete="off"
        placeholder='*************7845'
        maxLength={18}
        hint={<span aria-live="polite">{clabeHint(clabe)}</span>}
        error={errors.clabe?.message}
        {...register('clabe')}
      />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Guardando…' : 'Guardar beneficiario'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
