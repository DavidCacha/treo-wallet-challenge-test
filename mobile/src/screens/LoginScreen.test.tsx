import { screen, userEvent } from '@testing-library/react-native';
import { __resetSessionForTests } from '../api/session';
import { KEYS } from '../api/secureStorage';
import { AuthProvider } from '../auth/AuthContext';
import { AppRoot } from '../AppRoot';
import { json, mockFetch, renderWithProviders, secureStore, tokens } from '../test/helpers';

const me = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ana@treo.dev',
  full_name: 'Ana López',
  created_at: '2026-01-01T00:00:00Z',
  daily_limit_cents: 5_000_000,
  used_today_cents: 0,
  otp_threshold_cents: 1_000_000,
  business_timezone: 'America/Mexico_City',
};

const app = () => (
  <AuthProvider>
    <AppRoot />
  </AuthProvider>
);

beforeEach(() => {
  secureStore().clear();
  __resetSessionForTests();
});

describe('LoginScreen [R1.4, R1.11]', () => {
  it('valida el formulario sin llamar a la API', async () => {
    const { calls } = mockFetch([]);
    const user = userEvent.setup();
    await renderWithProviders(app());
    await user.press(await screen.findByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Correo inválido')).toBeOnTheScreen();
    expect(calls).toHaveLength(0);
  });

  it('muestra el mensaje de credenciales inválidas', async () => {
    mockFetch([
      {
        method: 'POST',
        path: '/auth/login',
        handler: () => json({ code: 'INVALID_CREDENTIALS', status: 401 }, 401),
      },
    ]);
    const user = userEvent.setup();
    await renderWithProviders(app());
    await user.type(await screen.findByLabelText('Correo'), 'ana@treo.dev');
    await user.type(screen.getByLabelText('Contraseña'), 'mala');
    await user.press(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeOnTheScreen();
    expect(secureStore().size).toBe(0);
  });

  it('con credenciales válidas entra al inicio y guarda la sesión en SecureStore', async () => {
    mockFetch([
      { method: 'POST', path: '/auth/login', handler: () => json(tokens(1)) },
      { method: 'GET', path: '/me', handler: () => json(me) },
      { method: 'GET', path: '/accounts', handler: () => json({ data: [] }) },
    ]);
    const user = userEvent.setup();
    await renderWithProviders(app());
    await user.type(await screen.findByLabelText('Correo'), 'ana@treo.dev');
    await user.type(screen.getByLabelText('Contraseña'), 'Demo12345!');
    await user.press(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Hola, Ana López')).toBeOnTheScreen();
    expect(secureStore().get(KEYS.refreshToken)).toBe('refresh-1');
  });

  it('al abrir la app con sesión guardada la restaura sin pedir login', async () => {
    secureStore().set(KEYS.refreshToken, 'refresh-1');
    mockFetch([
      { method: 'POST', path: '/auth/refresh', handler: () => json(tokens(2)) },
      { method: 'GET', path: '/me', handler: () => json(me) },
      { method: 'GET', path: '/accounts', handler: () => json({ data: [] }) },
    ]);
    await renderWithProviders(app());
    expect(await screen.findByText('Hola, Ana López')).toBeOnTheScreen();
  });
});
