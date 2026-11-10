import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { API } from '../test/fixtures';
import { renderApp } from '../test/render';

describe('RequireAuth [R1.10]', () => {
  it('al recargar sin token en memoria, recupera la sesión con la cookie de refresh', async () => {
    const { router } = renderApp('/beneficiaries');
    expect(await screen.findByRole('heading', { name: 'Beneficiarios' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/beneficiaries');
  });

  it('sin sesión válida redirige a /login', async () => {
    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
      ),
    );
    const { router } = renderApp('/beneficiaries');
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });
});
