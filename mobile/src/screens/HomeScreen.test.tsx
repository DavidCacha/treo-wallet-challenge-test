import { act, screen, userEvent } from '@testing-library/react-native';
import { HomeScreen } from './HomeScreen';
import { AuthProvider } from '../auth/AuthContext';
import { __resetSessionForTests } from '../api/session';
import { KEYS } from '../api/secureStorage';
import {
  json,
  mockFetch,
  networkError,
  renderWithProviders,
  secureStore,
  setConnected,
  tokens,
} from '../test/helpers';
import { accounts, me, movement } from '../test/fixtures';

const home = () => (
  <AuthProvider>
    <HomeScreen />
  </AuthProvider>
);

beforeEach(() => {
  secureStore().clear();
  secureStore().set(KEYS.refreshToken, 'refresh-1');
  __resetSessionForTests();
  setConnected(true);
});

const base = [
  { method: 'POST', path: '/auth/refresh', handler: () => json(tokens(2)) },
  { method: 'GET', path: '/me', handler: () => json(me) },
];

describe('HomeScreen [R2.1, R5.7, R2.5]', () => {
  it('muestra el saldo disponible de cada cuenta y los movimientos de la primera', async () => {
    const { calls } = mockFetch([
      ...base,
      { method: 'GET', path: '/accounts', handler: () => json({ data: accounts }) },
      {
        method: 'GET',
        path: `/accounts/${accounts[0]!.id}/movements`,
        handler: () => json({ data: [movement('m1', -50_000, 'Beto')], next_cursor: null }),
      },
    ]);
    await renderWithProviders(home());
    expect(await screen.findByText('$93,249.51')).toBeOnTheScreen();
    expect(screen.getByText('$5,000.00')).toBeOnTheScreen();
    expect(await screen.findByText('-$500.00')).toBeOnTheScreen();
    expect(screen.getByText('Beto')).toBeOnTheScreen();
    const movCall = calls.find((c) => c.url.includes('/movements'));
    expect(movCall?.url).toContain('limit=20');
  });

  it('al elegir otra cuenta carga sus movimientos; si no hay, muestra el estado vacío', async () => {
    mockFetch([
      ...base,
      { method: 'GET', path: '/accounts', handler: () => json({ data: accounts }) },
      {
        method: 'GET',
        path: `/accounts/${accounts[0]!.id}/movements`,
        handler: () => json({ data: [movement('m1', 100_00, 'Beto')], next_cursor: null }),
      },
      {
        method: 'GET',
        path: `/accounts/${accounts[1]!.id}/movements`,
        handler: () => json({ data: [], next_cursor: null }),
      },
    ]);
    const user = userEvent.setup();
    await renderWithProviders(home());
    await user.press(await screen.findByLabelText(/^Ahorro, saldo disponible/));
    expect(await screen.findByText('Sin movimientos')).toBeOnTheScreen();
    expect(screen.getByText('Últimos movimientos · Ahorro')).toBeOnTheScreen();
  });

  it('si falla la carga muestra el error y permite reintentar', async () => {
    let fail = true;
    mockFetch([
      ...base,
      {
        method: 'GET',
        path: '/accounts',
        handler: () => (fail ? networkError() : json({ data: accounts })),
      },
      {
        method: 'GET',
        path: /\/movements$/,
        handler: () => json({ data: [], next_cursor: null }),
      },
    ]);
    const user = userEvent.setup();
    await renderWithProviders(home());
    expect(
      await screen.findByText('No pudimos comunicarnos con el servidor. Revisa tu conexión.'),
    ).toBeOnTheScreen();
    fail = false;
    await user.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('$93,249.51')).toBeOnTheScreen();
  });

  it('muestra el aviso de sin conexión cuando NetInfo reporta que no hay red', async () => {
    mockFetch([
      ...base,
      { method: 'GET', path: '/accounts', handler: () => json({ data: accounts }) },
      { method: 'GET', path: /\/movements$/, handler: () => json({ data: [], next_cursor: null }) },
    ]);
    await renderWithProviders(home());
    expect(await screen.findByText('$93,249.51')).toBeOnTheScreen();
    await act(async () => setConnected(false));
    expect(
      screen.getByText('Sin conexión. Mostramos la última información disponible.'),
    ).toBeOnTheScreen();
    // Los saldos ya cargados siguen visibles.
    expect(screen.getByText('$93,249.51')).toBeOnTheScreen();
    await act(async () => setConnected(true));
    expect(
      screen.queryByText('Sin conexión. Mostramos la última información disponible.'),
    ).not.toBeOnTheScreen();
  });

  it('pull-to-refresh vuelve a pedir saldos y movimientos', async () => {
    let balance = 93_249_51;
    const { calls } = mockFetch([
      ...base,
      {
        method: 'GET',
        path: '/accounts',
        handler: () =>
          json({ data: [{ ...accounts[0]!, available_balance_cents: balance }, accounts[1]] }),
      },
      { method: 'GET', path: /\/movements$/, handler: () => json({ data: [], next_cursor: null }) },
    ]);
    await renderWithProviders(home());
    expect(await screen.findByText('$93,249.51')).toBeOnTheScreen();
    balance = 92_749_51;
    const list = screen.getByLabelText('Últimos movimientos');
    await act(async () => {
      list.props.refreshControl.props.onRefresh();
    });
    expect(await screen.findByText('$92,749.51')).toBeOnTheScreen();
    expect(calls.filter((c) => c.url.endsWith('/accounts'))).toHaveLength(2);
  });
});
