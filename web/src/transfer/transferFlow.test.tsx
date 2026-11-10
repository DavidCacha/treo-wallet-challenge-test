import { http, HttpResponse, delay } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { accounts, API, beneficiaries, problem, transfer } from '../test/fixtures';
import { renderApp } from '../test/render';
import type { Transfer } from '../api/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Call {
  key: string | null;
  body: unknown;
}

/** Registra cada POST /transfers y responde con lo que indique `respond`. */
function transfersEndpoint(respond: (n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  server.use(
    http.post(`${API}/transfers`, async ({ request }) => {
      calls.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
      return respond(calls.length);
    }),
  );
  return calls;
}

function serveTransfer(t: Transfer) {
  server.use(http.get(`${API}/transfers/${t.id}`, () => HttpResponse.json(t)));
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  { amount = '50', concept = 'Comida', reference = '1' } = {},
) {
  renderAppOnce();
  await user.selectOptions(await screen.findByLabelText('Destino'), `b:${beneficiaries[0]!.id}`);
  await user.clear(screen.getByLabelText('Monto (MXN)'));
  await user.type(screen.getByLabelText('Monto (MXN)'), amount);
  await user.clear(screen.getByLabelText('Concepto'));
  await user.type(screen.getByLabelText('Concepto'), concept);
  await user.clear(screen.getByLabelText('Referencia numérica'));
  await user.type(screen.getByLabelText('Referencia numérica'), reference);
}

let rendered: ReturnType<typeof renderApp> | null = null;
function renderAppOnce() {
  if (!rendered || !document.body.contains(rendered.container)) rendered = renderApp('/transfer');
  return rendered;
}
function router() {
  return renderAppOnce().router;
}

async function goToReview(
  user: ReturnType<typeof userEvent.setup>,
  opts?: Parameters<typeof fillForm>[1],
) {
  await fillForm(user, opts);
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('heading', { name: 'Confirma la transferencia' });
}

describe('Flujo de transferencia web [R4.5, R4.14, R4.15, R6.3, EC-1, EC-3]', () => {
  it('éxito: confirma, envía una llave UUID y muestra el comprobante', async () => {
    const t = transfer();
    serveTransfer(t);
    const calls = transfersEndpoint(() => HttpResponse.json(t, { status: 201 }));
    const user = userEvent.setup();
    await goToReview(user, { amount: '1,234.5', concept: 'Comida', reference: '0042' });

    const review = screen
      .getByRole('heading', { name: 'Confirma la transferencia' })
      .closest('section')!;
    expect(within(review).getByText('$1,234.50')).toBeInTheDocument();
    expect(within(review).getByText(/Beto \(Beto Demo\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(
      await screen.findByRole('heading', { name: 'Transferencia completada' }),
    ).toBeInTheDocument();
    expect(screen.getByText('TRX20261110ABCDEF12')).toBeInTheDocument();
    expect(router().state.location.pathname).toBe(`/transfer/${t.id}/receipt`);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toMatch(UUID);
    expect(calls[0]!.body).toEqual({
      source_account_id: accounts[0]!.id,
      beneficiary_id: beneficiaries[0]!.id,
      amount_cents: 123_450,
      concept: 'Comida',
      reference: '0042',
    });
  });

  it('INSUFFICIENT_FUNDS: muestra el mensaje y no navega al comprobante', async () => {
    const rejected = transfer({
      status: 'REJECTED',
      rejection_code: 'INSUFFICIENT_FUNDS',
      completed_at: null,
    });
    const calls = transfersEndpoint(() =>
      HttpResponse.json(problem(422, 'INSUFFICIENT_FUNDS', { transfer: rejected }), {
        status: 422,
      }),
    );
    const user = userEvent.setup();
    await goToReview(user, { amount: '999999.99' });
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('La transferencia no se realizó');
    expect(alert).toHaveTextContent('Saldo insuficiente en la cuenta de origen.');
    expect(router().state.location.pathname).toBe('/transfer/review');
    expect(
      screen.queryByRole('heading', { name: 'Transferencia completada' }),
    ).not.toBeInTheDocument();
    // El rechazo es definitivo para esta llave: no se ofrece reenviar.
    expect(screen.queryByRole('button', { name: /Enviar|Reintentar/ })).not.toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it('doble clic en "Enviar": una sola petición y el botón queda deshabilitado', async () => {
    const t = transfer();
    serveTransfer(t);
    const calls = transfersEndpoint(async () => {
      await delay(50);
      return HttpResponse.json(t, { status: 201 });
    });
    const user = userEvent.setup();
    await goToReview(user);
    const send = screen.getByRole('button', { name: 'Enviar' });
    await user.dblClick(send);
    expect(await screen.findByRole('button', { name: 'Enviando…' })).toBeDisabled();
    await screen.findByRole('heading', { name: 'Transferencia completada' });
    expect(calls).toHaveLength(1);
  });

  it('error de red: el reintento usa la MISMA Idempotency-Key', async () => {
    const t = transfer();
    serveTransfer(t);
    const calls = transfersEndpoint((n) =>
      n === 1
        ? HttpResponse.error()
        : HttpResponse.json(t, { status: 201, headers: { 'Idempotent-Replayed': 'true' } }),
    );
    const user = userEvent.setup();
    await goToReview(user);
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos confirmar el resultado');
    await user.click(screen.getByRole('button', { name: 'Reintentar envío' }));
    await screen.findByRole('heading', { name: 'Transferencia completada' });

    expect(calls).toHaveLength(2);
    expect(calls[1]!.key).toBe(calls[0]!.key);
    expect(calls[1]!.body).toEqual(calls[0]!.body);
  });

  it('503 TRY_AGAIN también se reintenta con la misma llave', async () => {
    const t = transfer();
    serveTransfer(t);
    const calls = transfersEndpoint((n) =>
      n === 1
        ? HttpResponse.json(problem(503, 'TRY_AGAIN'), { status: 503 })
        : HttpResponse.json(t, { status: 201 }),
    );
    const user = userEvent.setup();
    await goToReview(user);
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(await screen.findByRole('button', { name: 'Reintentar envío' }));
    await screen.findByRole('heading', { name: 'Transferencia completada' });
    expect(calls.map((c) => c.key)).toEqual([calls[0]!.key, calls[0]!.key]);
  });

  it('"Corregir datos" tras un rechazo inicia un intento nuevo con otra llave', async () => {
    const t = transfer();
    serveTransfer(t);
    const calls = transfersEndpoint((n) =>
      n === 1
        ? HttpResponse.json(problem(422, 'DAILY_LIMIT_EXCEEDED'), { status: 422 })
        : HttpResponse.json(t, { status: 201 }),
    );
    const user = userEvent.setup();
    await goToReview(user, { amount: '45000' });
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('límite diario');

    await user.click(screen.getByRole('button', { name: 'Corregir datos' }));
    // Conserva lo capturado para corregirlo.
    expect(await screen.findByLabelText('Monto (MXN)')).toHaveValue('45000');
    await user.clear(screen.getByLabelText('Monto (MXN)'));
    await user.type(screen.getByLabelText('Monto (MXN)'), '50');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(await screen.findByRole('button', { name: 'Enviar' }));
    await screen.findByRole('heading', { name: 'Transferencia completada' });

    expect(calls).toHaveLength(2);
    expect(calls[1]!.key).toMatch(UUID);
    expect(calls[1]!.key).not.toBe(calls[0]!.key);
  });

  it('"Editar" descarta la llave: el siguiente envío lleva una llave nueva', async () => {
    const t = transfer();
    serveTransfer(t);
    const calls = transfersEndpoint((n) =>
      n === 1 ? HttpResponse.error() : HttpResponse.json(t, { status: 201 }),
    );
    const user = userEvent.setup();
    await goToReview(user);
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await screen.findByRole('button', { name: 'Reintentar envío' });
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.click(await screen.findByRole('button', { name: 'Continuar' }));
    await user.click(await screen.findByRole('button', { name: 'Enviar' }));
    await screen.findByRole('heading', { name: 'Transferencia completada' });
    expect(calls[1]!.key).not.toBe(calls[0]!.key);
  });

  it('EC-3: "100.005" muestra "Máximo 2 decimales" y no envía nada', async () => {
    const calls = transfersEndpoint(() => HttpResponse.json({}, { status: 500 }));
    const user = userEvent.setup();
    await fillForm(user, { amount: '100.005' });
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('Máximo 2 decimales')).toBeInTheDocument();
    expect(screen.getByLabelText('Monto (MXN)')).toHaveFocus();
    expect(router().state.location.pathname).toBe('/transfer');
    expect(calls).toHaveLength(0);
  });

  it('valida concepto y referencia con el esquema compartido', async () => {
    const user = userEvent.setup();
    await fillForm(user, { reference: '12a' });
    await user.clear(screen.getByLabelText('Concepto'));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(
      await screen.findByText('La referencia debe tener de 1 a 7 dígitos'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Concepto')).toHaveAttribute('aria-invalid', 'true');
  });

  it('OTP: 202 lleva al código; un código inválido muestra intentos y uno válido el comprobante', async () => {
    const pending = transfer({
      status: 'PENDING_OTP',
      amount_cents: 1_500_000,
      completed_at: null,
      challenge: {
        id: 'e0000000-0000-4000-8000-000000000001',
        expires_at: '2026-11-10T18:05:00.000Z',
        attempts_remaining: 3,
      },
    });
    const done = {
      ...pending,
      status: 'COMPLETED' as const,
      challenge: null,
      completed_at: '2026-11-10T18:01:00.000Z',
    };
    let completed = false;
    const codes: string[] = [];
    transfersEndpoint(() => HttpResponse.json(pending, { status: 202 }));
    server.use(
      http.get(`${API}/transfers/${pending.id}`, () =>
        HttpResponse.json(completed ? done : pending),
      ),
      http.post(`${API}/transfers/${pending.id}/confirm`, async ({ request }) => {
        const { code } = (await request.json()) as { code: string };
        codes.push(code);
        if (code !== '123456') {
          return HttpResponse.json(problem(422, 'OTP_INVALID', { attempts_remaining: 2 }), {
            status: 422,
          });
        }
        completed = true;
        return HttpResponse.json(done);
      }),
    );
    const user = userEvent.setup();
    await goToReview(user, { amount: '15000' });
    expect(screen.getByText(/Te pediremos un código/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(
      await screen.findByRole('heading', { name: 'Código de confirmación' }),
    ).toBeInTheDocument();
    const codeInput = screen.getByRole('textbox', { name: 'Código' });
    await user.type(codeInput, '111111');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(
      await screen.findByText('El código no es correcto. Te quedan 2 intentos.'),
    ).toBeInTheDocument();

    await user.type(codeInput, '123456');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(
      await screen.findByRole('heading', { name: 'Transferencia completada' }),
    ).toBeInTheDocument();
    expect(codes).toEqual(['111111', '123456']);
  });

  it('OTP expirado: informa que la transferencia no se realizó', async () => {
    const pending = transfer({
      status: 'PENDING_OTP',
      completed_at: null,
      challenge: { id: 'e1', expires_at: '2026-11-10T18:05:00.000Z', attempts_remaining: 1 },
    });
    serveTransfer(pending);
    server.use(
      http.post(`${API}/transfers/${pending.id}/confirm`, () =>
        HttpResponse.json(problem(422, 'OTP_EXPIRED'), { status: 422 }),
      ),
    );
    const user = userEvent.setup();
    rendered = renderApp(`/transfer/${pending.id}/otp`);
    await user.type(await screen.findByRole('textbox', { name: 'Código' }), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('heading', { name: 'Código expirado' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('La transferencia no se realizó');
  });

  it('muestra el aviso de código si el monto a tercero supera el umbral', async () => {
    const user = userEvent.setup();
    await fillForm(user, { amount: '10,000.01' });
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Requerirá un código de confirmación',
    );
    await user.clear(screen.getByLabelText('Monto (MXN)'));
    await user.type(screen.getByLabelText('Monto (MXN)'), '10,000');
    await waitFor(() =>
      expect(screen.queryByText(/Requerirá un código de confirmación/)).not.toBeInTheDocument(),
    );
  });

  it('sin beneficiarios ni otra cuenta: ofrece agregar un beneficiario', async () => {
    server.use(
      http.get(`${API}/beneficiaries`, () => HttpResponse.json({ data: [] })),
      http.get(`${API}/accounts`, () => HttpResponse.json({ data: [accounts[0]] })),
    );
    rendered = renderApp('/transfer');
    expect(await screen.findByText('Todavía no tienes a quién transferir.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agregar beneficiario' })).toHaveAttribute(
      'href',
      '/beneficiaries',
    );
  });
});
