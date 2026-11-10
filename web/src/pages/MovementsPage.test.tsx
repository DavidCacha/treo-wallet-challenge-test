import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { accounts, API, movement, problem } from '../test/fixtures';
import { renderApp } from '../test/render';

const accountId = accounts[0]!.id;
const path = `/accounts/${accountId}/movements`;

interface Seen {
  cursor: string | null;
  from: string | null;
  to: string | null;
  type: string | null;
  limit: string | null;
}

function pagedHandler(seen: Seen[]) {
  return http.get(`${API}/accounts/:id/movements`, ({ request }) => {
    const u = new URL(request.url);
    const q: Seen = {
      cursor: u.searchParams.get('cursor'),
      from: u.searchParams.get('from'),
      to: u.searchParams.get('to'),
      type: u.searchParams.get('type'),
      limit: u.searchParams.get('limit'),
    };
    seen.push(q);
    if (q.type === 'DEPOSIT') {
      return HttpResponse.json({
        data: [movement(50, { type: 'DEPOSIT', amount_cents: 99_00, concept: 'Depósito inicial' })],
        next_cursor: null,
      });
    }
    if (!q.cursor) {
      return HttpResponse.json({
        data: [movement(0), movement(1)],
        next_cursor: 'cursor-pagina-2',
      });
    }
    return HttpResponse.json({ data: [movement(2)], next_cursor: null });
  });
}

describe('Historial [R5.3, R5.8]', () => {
  it('"Cargar más" pide la siguiente página con el cursor y agrega los movimientos', async () => {
    const seen: Seen[] = [];
    server.use(pagedHandler(seen));
    const user = userEvent.setup();
    renderApp(path);

    const list = await screen.findByRole('list', { name: 'Movimientos' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('-$10.00')).toBeInTheDocument();
    expect(seen[0]).toMatchObject({ cursor: null, limit: '20' });

    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    expect(seen[1]).toMatchObject({ cursor: 'cursor-pagina-2' });
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
    expect(screen.getByText('No hay más movimientos.')).toBeInTheDocument();
  });

  it('cambiar un filtro lo refleja en la URL y reinicia la lista desde la primera página', async () => {
    const seen: Seen[] = [];
    server.use(pagedHandler(seen));
    const user = userEvent.setup();
    const { router } = renderApp(path);

    await screen.findByRole('list', { name: 'Movimientos' });
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(seen).toHaveLength(2));

    await user.selectOptions(screen.getByLabelText('Tipo'), 'DEPOSIT');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

    await waitFor(() => expect(router.state.location.search).toBe('?type=DEPOSIT'));
    const list = await screen.findByRole('list', { name: 'Movimientos' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(within(list).getByText(/Depósito inicial/)).toBeInTheDocument();
    expect(seen.at(-1)).toMatchObject({ type: 'DEPOSIT', cursor: null });
  });

  it('lee los filtros de la URL al abrir la página', async () => {
    const seen: Seen[] = [];
    server.use(pagedHandler(seen));
    renderApp(`${path}?from=2026-11-01&to=2026-11-10&type=TRANSFER_OUT`);
    await screen.findByRole('list', { name: 'Movimientos' });
    expect(seen[0]).toMatchObject({ from: '2026-11-01', to: '2026-11-10', type: 'TRANSFER_OUT' });
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-11-01');
    expect(screen.getByLabelText('Tipo')).toHaveValue('TRANSFER_OUT');
  });

  it('rechaza "desde" posterior a "hasta" sin llamar a la API', async () => {
    const seen: Seen[] = [];
    server.use(pagedHandler(seen));
    const user = userEvent.setup();
    renderApp(path);
    await screen.findByRole('list', { name: 'Movimientos' });
    await user.type(screen.getByLabelText('Desde'), '2026-11-10');
    await user.type(screen.getByLabelText('Hasta'), '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('`from` no puede ser posterior');
    expect(seen).toHaveLength(1);
  });

  it('estado vacío con filtros', async () => {
    renderApp(`${path}?type=DEPOSIT`);
    expect(await screen.findByText('Sin movimientos en este rango.')).toBeInTheDocument();
  });

  it('estado de error', async () => {
    server.use(
      http.get(`${API}/accounts/:id/movements`, () =>
        HttpResponse.json(problem(404, 'NOT_FOUND'), { status: 404 }),
      ),
    );
    renderApp(path);
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos lo que buscas.');
  });
});
