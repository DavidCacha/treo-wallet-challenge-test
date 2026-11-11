import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { confirmTransferSchema, formatCents } from '@treo/shared';
import type { Transfer } from '../api/types';
import { Button } from '../components/Button';
import { DetailRows } from '../components/DetailRows';
import { Screen } from '../components/Screen';
import { LoadingState, Notice } from '../components/States';
import { TextField } from '../components/TextField';
import { colors, space } from '../components/theme';
import { formatDateTime } from '../lib/format';
import { useNav } from '../navigation';
import type { TransferFormValues } from '../transfer/draft';
import { BACKOFF_MS } from '../transfer/machine';
import type { PendingTransfer } from '../transfer/pendingStore';
import { useTransfer } from '../transfer/TransferContext';

function summaryRows(pending: PendingTransfer | null, t?: Transfer): Array<[string, string]> {
  if (t) {
    return [
      ['Monto', formatCents(t.amount_cents)],
      ['Para', t.destination.display_name],
      ['CLABE', t.destination.clabe_masked],
      ['Concepto', t.concept],
      ['Referencia', t.reference],
    ];
  }
  if (!pending) return [];
  return [
    ['Monto', formatCents(pending.payload.amount_cents)],
    ['Desde', pending.display.sourceName],
    ['Para', pending.display.beneficiaryAlias],
    ['Concepto', pending.payload.concept],
    ['Referencia', pending.payload.reference],
  ];
}

/**
 * Estado real de la transferencia según el servidor (R4.17): enviando,
 * reintentando, desconocido, código OTP o resultado definitivo.
 */
export function TransferStatusScreen({ values }: { values?: TransferFormValues }) {
  const nav = useNav();
  const { state, pending, verifyAgain, confirmOtp, reset } = useTransfer();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const goHome = () => {
    reset();
    nav.reset({ name: 'home' });
  };

  switch (state.kind) {
    case 'idle':
    case 'sending':
      return (
        <Screen title="Enviando transferencia">
          <LoadingState label="Enviando…" />
          <DetailRows rows={summaryRows(pending)} />
        </Screen>
      );

    case 'retrying':
      return (
        <Screen title="Enviando transferencia">
          <Notice tone="warning" title="Sin respuesta del servidor">
            {state.waitingForNetwork
              ? 'No hay conexión. Reanudaremos el envío en cuanto vuelva la red.'
              : `Reintentando (${state.retry} de ${BACKOFF_MS.length})…`}
          </Notice>
          <Text style={styles.muted}>
            Reintentamos con el mismo identificador de operación: aunque el primer envío haya
            llegado, la transferencia no se duplicará.
          </Text>
          <DetailRows rows={summaryRows(pending)} />
        </Screen>
      );

    case 'unknown':
      return (
        <Screen title="Estado por confirmar">
          <Notice tone="warning" title="No pudimos confirmar el estado">
            No sabemos todavía si la transferencia se realizó. Verifica de nuevo antes de hacer otra
            operación: usaremos el mismo identificador y no se duplicará.
          </Notice>
          <DetailRows rows={summaryRows(pending)} />
          <View style={styles.actions}>
            <Button title="Verificar de nuevo" onPress={() => void verifyAgain()} />
            <Button
              title="Volver al inicio"
              variant="secondary"
              onPress={() => nav.reset({ name: 'home' })}
            />
          </View>
        </Screen>
      );

    case 'otp':
    case 'confirming': {
      const t = state.transfer;
      const confirming = state.kind === 'confirming';
      const left = state.kind === 'otp' ? state.attemptsRemaining : undefined;
      const submit = () => {
        if (confirming) return;
        const parsed = confirmTransferSchema.safeParse({ code: code.trim() });
        if (!parsed.success) {
          setCodeError(parsed.error.issues[0]?.message ?? 'Código inválido');
          return;
        }
        setCodeError(null);
        setCode('');
        void confirmOtp(parsed.data.code);
      };
      return (
        <Screen title="Código de confirmación">
          <Text style={styles.body}>
            {`Para enviar ${formatCents(t.amount_cents)} a ${t.destination.display_name} escribe el código de 6 dígitos.`}
          </Text>
          {t.challenge && (
            <Text style={styles.muted}>
              {`Vence ${formatDateTime(t.challenge.expires_at)}`}
              {typeof left === 'number' ? ` · Intentos restantes: ${left}` : ''}
            </Text>
          )}
          {t.challenge?.dev_otp_code && (
            <Notice>{`Entorno de desarrollo: el código simulado es ${t.challenge.dev_otp_code}.`}</Notice>
          )}
          {state.kind === 'otp' && state.error && <Notice tone="error">{state.error}</Notice>}
          <TextField
            label="Código"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            error={codeError}
          />
          <Button title="Confirmar" onPress={submit} loading={confirming} />
        </Screen>
      );
    }

    case 'completed': {
      const t = state.transfer;
      return (
        <Screen title="Transferencia completada">
          <Notice tone="success" title={`Enviaste ${formatCents(t.amount_cents)}`}>
            {`Folio ${t.tracking_code}`}
          </Notice>
          <DetailRows
            rows={[
              ...summaryRows(null, t),
              ...(t.completed_at
                ? ([['Fecha', formatDateTime(t.completed_at)]] as Array<[string, string]>)
                : []),
            ]}
          />
          <Button title="Volver al inicio" onPress={goHome} />
        </Screen>
      );
    }

    case 'rejected':
      return (
        <Screen title="Transferencia no realizada">
          <Notice tone="error" title="La transferencia no se realizó">
            {state.message}
          </Notice>
          <DetailRows rows={summaryRows(null, state.transfer)} />
          <View style={styles.actions}>
            {values && (
              <Button
                title="Corregir datos"
                onPress={() => {
                  reset();
                  nav.reset({ name: 'home' });
                  nav.push({ name: 'transferForm', values });
                }}
              />
            )}
            <Button title="Volver al inicio" variant="secondary" onPress={goHome} />
          </View>
        </Screen>
      );

    case 'expired':
      return (
        <Screen title="Código expirado">
          <Notice tone="error" title="La transferencia no se realizó">
            {state.message}
          </Notice>
          <Button title="Volver al inicio" onPress={goHome} />
        </Screen>
      );
  }
}

const styles = StyleSheet.create({
  actions: { gap: space.sm },
  muted: { color: colors.muted, marginBottom: space.md, lineHeight: 20 },
  body: { color: colors.text, marginBottom: space.sm, lineHeight: 22, fontSize: 16 },
});
