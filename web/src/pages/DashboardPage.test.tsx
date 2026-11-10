import { http, HttpResponse, delay } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { API, problem } from '../test/fixtures';
import { renderApp } from '../test/render';

describe('Resumen de cuentas [R2.1, R2.4, R2.5, R6.8]', () => {
  it('muestra el estado de carga', async () => {
    server.use(
      http.get(`${API}/accounts`, async () => {
        await delay('infinite');
        return HttpResponse.json({ data: [] });
      }),
    );
    renderApp('/');
    const loading = (await screen.findByText('Cargando cuentas…')).closest('[role="status"]');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('formatea 123456 centavos como $1,234.56 y muestra el límite disponible', async () => {
    renderApp('/');
    const list = await screen.findByRole('list', { name: 'Cuentas' });
    const principal = within(list).getByRole('heading', { name: 'Principal' }).closest('li')!;
    expect(principal).toHaveTextContent('$1,234.56');
    expect(within(list).getByText('$50,000.00')).toBeInTheDocument();
    // límite 50,000.00 − usado 1,250.00
    expect(await screen.findByText('$48,750.00')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Uso del límite diario' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    expect(within(principal).getByRole('link', { name: /Ver movimientos/ })).toHaveAttribute(
      'href',
      '/accounts/a0000000-0000-4000-8000-000000000001/movements',
    );
  });

  it('estado vacío', async () => {
    server.use(http.get(`${API}/accounts`, () => HttpResponse.json({ data: [] })));
    renderApp('/');
    expect(await screen.findByText('Todavía no tienes cuentas.')).toBeInTheDocument();
  });

  it('estado de error con "Reintentar" que vuelve a pedir los datos', async () => {
    let fail = true;
    server.use(
      http.get(`${API}/accounts`, () =>
        fail
          ? HttpResponse.json(problem(500, 'INTERNAL_ERROR'), { status: 500 })
          : HttpResponse.json({
              data: [
                {
                  id: 'a0000000-0000-4000-8000-000000000009',
                  name: 'Nueva',
                  clabe: '999180000000000090',
                  currency: 'MXN',
                  available_balance_cents: 5,
                  status: 'ACTIVE',
                },
              ],
            }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No pudimos cargar la información');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('$0.05')).toBeInTheDocument();
  });
});
