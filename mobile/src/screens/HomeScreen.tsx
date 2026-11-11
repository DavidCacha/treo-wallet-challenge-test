import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api/endpoints';
import { qk } from '../api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import { AccountCard } from '../components/AccountCard';
import { MovementItem } from '../components/MovementItem';
import { Screen } from '../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { colors, space } from '../components/theme';

/** R2.1 (saldos), R5.7 (últimos 20 movimientos), R2.5 (carga/vacío/error), sin conexión. */
export function HomeScreen() {
  const { logout } = useAuth();
  const me = useQuery({ queryKey: qk.me, queryFn: api.getMe });
  const accounts = useQuery({ queryKey: qk.accounts, queryFn: api.getAccounts });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    accounts.data?.find((a) => a.id === selectedId) ?? accounts.data?.[0] ?? undefined;

  const movements = useQuery({
    queryKey: qk.movements(selected?.id ?? ''),
    queryFn: () => api.getRecentMovements(selected!.id),
    enabled: !!selected,
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([accounts.refetch(), me.refetch(), selected && movements.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const header = (
    <View>
      {accounts.isPending && <LoadingState label="Cargando cuentas…" />}
      {accounts.isError && !accounts.data && (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      )}
      {accounts.data?.length === 0 && (
        <EmptyState title="Aún no tienes cuentas">
          Cuando se abra tu cuenta aparecerá aquí con su saldo.
        </EmptyState>
      )}
      {accounts.data?.map((a) => (
        <AccountCard
          key={a.id}
          account={a}
          selected={a.id === selected?.id}
          onPress={() => setSelectedId(a.id)}
        />
      ))}
      {selected && (
        <Text style={styles.section} accessibilityRole="header">
          Últimos movimientos · {selected.name}
        </Text>
      )}
      {selected && movements.isPending && <LoadingState label="Cargando movimientos…" />}
      {selected && movements.isError && !movements.data && (
        <ErrorState error={movements.error} onRetry={() => void movements.refetch()} />
      )}
      {movements.data?.data.length === 0 && (
        <EmptyState title="Sin movimientos">Esta cuenta todavía no tiene movimientos.</EmptyState>
      )}
    </View>
  );

  return (
    <Screen
      scroll={false}
      title={me.data ? `Hola, ${me.data.full_name}` : 'Inicio'}
      headerRight={
        <Text
          accessibilityRole="button"
          onPress={() => void logout()}
          style={styles.link}
          suppressHighlighting
        >
          Salir
        </Text>
      }
    >
      <FlatList
        data={selected ? (movements.data?.data ?? []) : []}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MovementItem movement={item} />}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
        contentContainerStyle={styles.list}
        accessibilityLabel="Últimos movimientos"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: space.lg },
  section: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  link: { color: colors.primary, fontWeight: '600', fontSize: 16, padding: space.xs },
});
