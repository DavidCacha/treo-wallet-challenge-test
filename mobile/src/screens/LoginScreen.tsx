import { useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { loginSchema } from '@treo/shared';
import { messageFor } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { Notice } from '../components/States';
import { TextField } from '../components/TextField';
import { colors, space } from '../components/theme';

/** R1.4 (login), R1.11 (tokens solo en SecureStore, ver api/session.ts). */
export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current) return;
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as 'email' | 'password';
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setFormError(null);
    inFlight.current = true;
    setPending(true);
    try {
      await login(parsed.data);
      // Al guardar los tokens la sesión cambia y se muestra el inicio.
    } catch (e) {
      setFormError(messageFor(e));
      setPending(false);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Screen title="Inicia sesión">
      <Text style={styles.lead}>Billetera digital en pesos mexicanos.</Text>
      {formError && <Notice tone="error">{formError}</Notice>}
      <TextField
        label="Correo"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        placeholder="user@treo.com"
        error={errors.email}
      />
      <TextField
        label="Contraseña"
        value={password}
        placeholder="Contraseña"
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        error={errors.password}
        onSubmitEditing={() => void submit()}
      />
      <Button title="Entrar" onPress={() => void submit()} loading={pending} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { color: colors.muted, marginBottom: space.lg },
});
