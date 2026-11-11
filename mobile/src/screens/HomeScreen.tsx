import { useQuery } from '@tanstack/react-query';
import * as api from '../api/endpoints';
import { qk } from '../api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { ErrorState, LoadingState, Notice } from '../components/States';

export function HomeScreen() {
  const { logout } = useAuth();
  const me = useQuery({ queryKey: qk.me, queryFn: api.getMe });
  return (
    <Screen title={me.data ? `Hola, ${me.data.full_name}` : 'Inicio'}>
      {me.isPending && <LoadingState />}
      {me.isError && <ErrorState error={me.error} onRetry={() => void me.refetch()} />}
      {me.data && <Notice>{`Sesión iniciada como ${me.data.email}.`}</Notice>}
      <Button title="Cerrar sesión" variant="secondary" onPress={() => void logout()} />
    </Screen>
  );
}
