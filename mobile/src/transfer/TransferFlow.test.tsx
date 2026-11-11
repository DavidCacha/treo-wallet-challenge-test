import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { AppRoot } from '../AppRoot';
import { AuthProvider } from '../auth/AuthContext';
import { __resetSessionForTests } from '../api/session';
import { KEYS } from '../api/secureStorage';
import { accounts, beneficiaries, me, transfer } from '../test/fixtures';
import {
  json,
  mockFetch,
  networkError,
  renderWithProviders,
  secureStore,
  setConnected,
  tokens,
} from '../test/helpers';
import type { Route } from '../test/helpers';
import type { PendingTransfer } from './pendingStore';

const app = () => (
  <AuthProvider>
    <AppRoot />
  </AuthProvider>
);

function routes(extra: Route[], opts: { beneficiaries?: unknown[] } = {}): Route[] {
  return [
    ...extra,
    { method: 'POST', path: '/auth/refresh', handler: () => json(tokens(2)) },
    { method: 'GET', path: '/me', handler: () => json(me) },
    { method: 'GET', path: '/accounts', handler: () => json({ data: accounts }) },
    {
      method: 'GET',
      path: '/beneficiaries',
      handler: () => json({ data: opts.beneficiaries ?? beneficiaries }),
    },
    { method: 'GET', path: /\/movements$/, handler: () => json({ data: [], next_cursor: null }) },
  ];
}

beforeEach(() => {
  secureStore().clear();
  secureStore().set(KEYS.refreshToken, 'refresh-1');
  __resetSessionForTests();
  setConnected(true);
});

async function fillForm(user: ReturnType<typeof userEvent.setup>, amount = '300') {
  await user.press(await screen.findByRole('button', { name: 'Transferir' }));
  await user.press(await screen.findByRole('radio', { name: /^Beto,/ }));
  await user.type(screen.getByLabelText('Monto (MXN)'), amount);
  await user.type(screen.getByLabelText('Concepto'), 'Comida');
  await user.press(screen.getByRole('button', { name: 'Continuar' }));
}

const posts = <T extends { method: string; url: string }>(calls: T[]) =>
  calls.filter((c) => c.method === 'POST' && c.url.endsWith('/transfers'));

describe('flujo de transferencia móvil [R4.16, R4.17, R6.3]', () => {
  it('envía a un beneficiario registrado y muestra el folio del servidor', async () => {
    const { calls } = mockFetch(
      routes([{ method: 'POST', path: '/transfers', handler: () => json(transfer(), 201) }]),
    );
    const user = userEvent.setup();
    await renderWithProviders(app());
    await fillForm(user);

    expect(await screen.findByText('Confirma la transferencia')).toBeOnTheScreen();
    expect(screen.getByText('$300.00')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Transferencia completada')).toBeOnTheScreen();
    expect(screen.getByText('Folio TRX20261111A1B2C3D4')).toBeOnTheScreen();
    const [post] = posts(calls);
    expect(post?.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(post?.body).toEqual({
      source_account_id: accounts[0]!.id,
      beneficiary_id: beneficiaries[0]!.id,
      amount_cents: 30_000,
      concept: 'Comida',
      reference: '2234567',
    });
    // Resultado definitivo: la llave ya no está guardada.
    expect(secureStore().has(KEYS.pendingTransfer)).toBe(false);
  });

  it('valida montos sin redondear (EC-3) y no envía nada', async () => {
    const { calls } = mockFetch(routes([]));
    const user = userEvent.setup();
    await renderWithProviders(app());
    await fillForm(user, '100.005');
    expect(await screen.findByText('Máximo 2 decimales')).toBeOnTheScreen();
    expect(posts(calls)).toHaveLength(0);
  });

  it('saldo insuficiente: muestra el rechazo del servidor y permite corregir', async () => {
    const rejected = transfer({ status: 'REJECTED', rejection_code: 'INSUFFICIENT_FUNDS' });
    mockFetch(
      routes([
        {
          method: 'POST',
          path: '/transfers',
          handler: () => json({ code: 'INSUFFICIENT_FUNDS', status: 422, transfer: rejected }, 422),
        },
      ]),
    );
    const user = userEvent.setup();
    await renderWithProviders(app());
    await fillForm(user);
    await user.press(await screen.findByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Saldo insuficiente en la cuenta de origen.')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Corregir datos' }));
    expect(await screen.findByLabelText('Monto (MXN)')).toHaveDisplayValue('300');
  });

  it('doble toque en "Enviar" produce un solo POST', async () => {
    const { calls } = mockFetch(
      routes([
        {
          method: 'POST',
          path: '/transfers',
          handler: async () => {
            await new Promise((r) => setTimeout(r, 50));
            return json(transfer(), 201);
          },
        },
      ]),
    );
    const user = userEvent.setup();
    await renderWithProviders(app());
    await fillForm(user);
    const send = await screen.findByRole('button', { name: 'Enviar' });
    await Promise.all([user.press(send), user.press(send)]);
    expect(await screen.findByText('Transferencia completada')).toBeOnTheScreen();
    expect(posts(calls)).toHaveLength(1);
  });

  it('pérdida de red a mitad del envío: reintenta con la MISMA llave y muestra el resultado real', async () => {
    let attempt = 0;
    const { calls } = mockFetch(
      routes([
        {
          method: 'POST',
          path: '/transfers',
          handler: () => {
            attempt += 1;
            // La primera respuesta "se pierde"; el reintento recibe el replay.
            return attempt === 1
              ? networkError()
              : json(transfer(), 201, { 'Idempotent-Replayed': 'true' });
          },
        },
      ]),
    );
    const user = userEvent.setup();
    await renderWithProviders(app());
    await fillForm(user);
    await user.press(await screen.findByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Sin respuesta del servidor')).toBeOnTheScreen();
    expect(
      await screen.findByText('Transferencia completada', {}, { timeout: 3000 }),
    ).toBeOnTheScreen();
    const sent = posts(calls);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.headers['Idempotency-Key']).toBe(sent[0]?.headers['Idempotency-Key']);
    expect(sent[1]?.body).toEqual(sent[0]?.body);
  });

  it('al abrir la app con un intento sin resolver consulta su estado antes de permitir otro', async () => {
    const saved: PendingTransfer = {
      v: 1,
      userId: me.id,
      idempotencyKey: '00000000-0000-4000-8000-00000000beef',
      payload: {
        source_account_id: accounts[0]!.id,
        beneficiary_id: beneficiaries[0]!.id,
        amount_cents: 30_000,
        concept: 'Comida',
        reference: '1234567',
      },
      display: {
        sourceName: 'Principal',
        beneficiaryAlias: 'Beto',
        beneficiaryClabe: '646180000000000034',
        requiresOtp: false,
      },
      createdAt: '2026-11-11T00:00:00Z',
    };
    secureStore().set(KEYS.pendingTransfer, JSON.stringify(saved));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { calls } = mockFetch(
      routes([
        {
          method: 'POST',
          path: '/transfers',
          handler: async () => {
            await gate;
            return json(transfer(), 201, { 'Idempotent-Replayed': 'true' });
          },
        },
      ]),
    );
    await renderWithProviders(app());
    // Mientras se verifica, no se ofrece "Transferir".
    expect(await screen.findByText('Tienes una transferencia en proceso')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Transferir' })).not.toBeOnTheScreen();

    release();
    expect(await screen.findByRole('button', { name: 'Transferir' })).toBeOnTheScreen();
    expect(posts(calls)[0]?.headers['Idempotency-Key']).toBe(saved.idempotencyKey);
    expect(secureStore().has(KEYS.pendingTransfer)).toBe(false);
  });

  it('sin beneficiarios indica registrarlos en la web (R4.16)', async () => {
    mockFetch(routes([], { beneficiaries: [] }));
    const user = userEvent.setup();
    await renderWithProviders(app());
    await user.press(await screen.findByRole('button', { name: 'Transferir' }));
    expect(await screen.findByText('Aún no tienes beneficiarios')).toBeOnTheScreen();
  });

  it('monto mayor al umbral: pide el código OTP y completa al confirmarlo', async () => {
    const pendingOtp = transfer({
      status: 'PENDING_OTP',
      amount_cents: 1_500_000,
      completed_at: null,
      challenge: {
        id: 'eeeeeeee-0000-4000-8000-000000000001',
        expires_at: '2026-11-11T18:05:00Z',
        attempts_remaining: 3,
        dev_otp_code: '654321',
      },
    } as never);
    const { calls } = mockFetch(
      routes([
        { method: 'POST', path: '/transfers', handler: () => json(pendingOtp, 202) },
        {
          method: 'POST',
          path: `/transfers/${pendingOtp.id}/confirm`,
          handler: ({ body }) =>
            (body as { code: string }).code === '654321'
              ? json(transfer({ amount_cents: 1_500_000 }))
              : json({ code: 'OTP_INVALID', status: 422, attempts_remaining: 2 }, 422),
        },
      ]),
    );
    const user = userEvent.setup();
    await renderWithProviders(app());
    await fillForm(user, '15,000');
    expect(
      await screen.findByText('Te pediremos un código de confirmación después de enviar.'),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Código de confirmación')).toBeOnTheScreen();
    await user.type(screen.getByLabelText('Código'), '111111');
    await user.press(screen.getByRole('button', { name: 'Confirmar' }));
    expect(
      await screen.findByText('El código no es correcto. Te quedan 2 intentos.'),
    ).toBeOnTheScreen();

    await user.type(screen.getByLabelText('Código'), '654321');
    await user.press(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Transferencia completada')).toBeOnTheScreen();
    await waitFor(() => expect(secureStore().has(KEYS.pendingTransfer)).toBe(false));
    expect(calls.filter((c) => c.url.endsWith('/confirm'))).toHaveLength(2);
  });
});

describe('navegación tras enviar', () => {
  afterEach(() => jest.restoreAllMocks());

  it('"Atrás" desde el resultado vuelve al inicio, no al formulario enviado', async () => {
    type BackListener = Parameters<typeof BackHandler.addEventListener>[1];
    const handlers: BackListener[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      handlers.push(h);
      return { remove: () => handlers.splice(handlers.indexOf(h), 1) };
    });
    mockFetch(
      routes([{ method: 'POST', path: '/transfers', handler: () => json(transfer(), 201) }]),
    );
    const user = userEvent.setup();
    await renderWithProviders(app());
    await fillForm(user);
    await user.press(await screen.findByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Transferencia completada')).toBeOnTheScreen();

    // Botón "atrás" de Android: el último manejador registrado es el vigente.
    await act(async () => {
      handlers[handlers.length - 1]?.({} as never);
    });
    expect(await screen.findByRole('button', { name: 'Transferir' })).toBeOnTheScreen();
  });
});
