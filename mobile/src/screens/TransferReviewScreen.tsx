import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatCents } from '@treo/shared';
import { Button } from '../components/Button';
import { DetailRows } from '../components/DetailRows';
import { Screen } from '../components/Screen';
import { Notice } from '../components/States';
import { space } from '../components/theme';
import { useNav } from '../navigation';
import type { TransferDraft } from '../transfer/draft';
import { useTransfer } from '../transfer/TransferContext';

/** Revisión antes de enviar. La llave de idempotencia se genera al confirmar. */
export function TransferReviewScreen({ draft }: { draft: TransferDraft }) {
  const nav = useNav();
  const { start } = useTransfer();
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { payload, display } = draft;

  const confirm = async () => {
    // Guardia síncrona además del botón deshabilitado: un doble toque no
    // genera dos intentos ni dos llaves.
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      // "Atrás" desde el estado vuelve al inicio, no al formulario ya enviado.
      await start(draft, () =>
        nav.reset([{ name: 'home' }, { name: 'transferStatus', values: draft.values }]),
      );
    } catch {
      // Solo falla si no se pudo guardar el intento en SecureStore: no se envió nada.
      sending.current = false;
      setBusy(false);
      setError('No pudimos preparar el envío en este dispositivo. Inténtalo de nuevo.');
    }
  };

  return (
    <Screen title="Confirma la transferencia">
      <DetailRows
        rows={[
          ['Monto', formatCents(payload.amount_cents)],
          ['Desde', display.sourceName],
          ['Para', display.beneficiaryAlias],
          ['CLABE', `···${display.beneficiaryClabe.slice(-4)}`],
          ['Concepto', payload.concept],
          ['Referencia', payload.reference],
        ]}
      />
      {display.requiresOtp && (
        <Notice tone="warning">Te pediremos un código de confirmación después de enviar.</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <View style={styles.actions}>
        <Button title="Enviar" onPress={() => void confirm()} loading={busy} />
        <Button
          title="Editar"
          variant="secondary"
          disabled={busy}
          onPress={() => nav.replace({ name: 'transferForm', values: draft.values })}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ actions: { gap: space.sm } });
