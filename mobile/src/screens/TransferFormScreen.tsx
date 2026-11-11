import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { formatCents, parseMxnToCents } from '@treo/shared';
import * as api from '../api/endpoints';
import { qk } from '../api/queryKeys';
import { Button } from '../components/Button';
import { ChoiceGroup } from '../components/Choice';
import { Screen } from '../components/Screen';
import { EmptyState, ErrorState, LoadingState, Notice } from '../components/States';
import { TextField } from '../components/TextField';
import { space } from '../components/theme';
import { useNav } from '../navigation';
import { generateReference, validateTransfer } from '../transfer/draft';
import type { FormErrors, TransferFormValues } from '../transfer/draft';

/** R4.16: solo a beneficiarios registrados. R6.8: aviso de código. Montos sin float. */
export function TransferFormScreen({ initial }: { initial?: TransferFormValues }) {
  const nav = useNav();
  const accounts = useQuery({ queryKey: qk.accounts, queryFn: api.getAccounts });
  const beneficiaries = useQuery({ queryKey: qk.beneficiaries, queryFn: api.getBeneficiaries });
  const me = useQuery({ queryKey: qk.me, queryFn: api.getMe });

  const [values, setValues] = useState<TransferFormValues>(
    () =>
      initial ?? {
        source_account_id: '',
        beneficiary_id: '',
        amount: '',
        concept: '',
        reference: generateReference(),
      },
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const set = (k: keyof TransferFormValues) => (v: string) => setValues((s) => ({ ...s, [k]: v }));

  const failed = [accounts, beneficiaries, me].find((q) => q.isError);
  if (failed) {
    return (
      <Screen title="Transferir">
        <ErrorState
          error={failed.error}
          onRetry={() => {
            void accounts.refetch();
            void beneficiaries.refetch();
            void me.refetch();
          }}
        />
        <Button title="Volver" variant="secondary" onPress={nav.back} />
      </Screen>
    );
  }
  if (!accounts.data || !beneficiaries.data || !me.data) {
    return (
      <Screen title="Transferir">
        <LoadingState />
      </Screen>
    );
  }

  const activeAccounts = accounts.data.filter((a) => a.status === 'ACTIVE');
  const sourceId = values.source_account_id || activeAccounts[0]?.id || '';

  if (beneficiaries.data.length === 0) {
    return (
      <Screen title="Transferir">
        <EmptyState title="Aún no tienes beneficiarios">
          Desde la app solo puedes transferir a beneficiarios ya registrados. Regístralos en la
          versión web y vuelve a intentarlo.
        </EmptyState>
        <Button title="Volver" variant="secondary" onPress={nav.back} />
      </Screen>
    );
  }

  const money = parseMxnToCents(values.amount);
  const requiresOtp = money.ok && money.cents > me.data.otp_threshold_cents;
  const availableToday = Math.max(0, me.data.daily_limit_cents - me.data.used_today_cents);

  const submit = () => {
    const current = { ...values, source_account_id: sourceId };
    const result = validateTransfer(current);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    const source = accounts.data.find((a) => a.id === result.payload.source_account_id);
    const beneficiary = beneficiaries.data.find((b) => b.id === result.payload.beneficiary_id);
    nav.push({
      name: 'transferReview',
      draft: {
        values: current,
        payload: result.payload,
        display: {
          sourceName: source?.name ?? '',
          beneficiaryAlias: beneficiary?.alias ?? '',
          beneficiaryClabe: beneficiary?.clabe ?? '',
          requiresOtp,
        },
      },
    });
  };

  return (
    <Screen title="Transferir">
      <ChoiceGroup
        label="Desde"
        value={sourceId}
        onChange={set('source_account_id')}
        error={errors.source_account_id}
        options={activeAccounts.map((a) => ({
          value: a.id,
          label: a.name,
          detail: `Disponible ${formatCents(a.available_balance_cents)}`,
        }))}
      />
      <ChoiceGroup
        label="Para"
        value={values.beneficiary_id}
        onChange={set('beneficiary_id')}
        error={errors.beneficiary_id}
        options={beneficiaries.data.map((b) => ({
          value: b.id,
          label: b.alias,
          detail: `${b.name} · CLABE ···${b.clabe.slice(-4)}`,
        }))}
      />
      <TextField
        label="Monto (MXN)"
        value={values.amount}
        onChangeText={set('amount')}
        keyboardType="decimal-pad"
        placeholder="0.00"
        error={errors.amount}
        hint={`Disponible hoy para terceros: ${formatCents(availableToday)}`}
      />
      {requiresOtp && (
        <Notice tone="warning">
          {`Te pediremos un código de confirmación: el monto supera ${formatCents(me.data.otp_threshold_cents)}.`}
        </Notice>
      )}
      <TextField
        label="Concepto"
        value={values.concept}
        onChangeText={set('concept')}
        maxLength={40}
        error={errors.concept}
      />
      <TextField
        label="Referencia"
        value={values.reference}
        onChangeText={set('reference')}
        keyboardType="number-pad"
        maxLength={7}
        error={errors.reference}
        hint="Generada automáticamente; puedes cambiarla."
      />
      <View style={styles.actions}>
        <Button title="Continuar" onPress={submit} />
        <Button title="Cancelar" variant="secondary" onPress={nav.back} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ actions: { gap: space.sm } });
