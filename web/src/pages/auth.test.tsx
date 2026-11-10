import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { API, problem } from '../test/fixtures';
import { renderApp } from '../test/render';

function anonymous() {
  server.use(
    http.post(`${API}/auth/refresh`, () =>
      HttpResponse.json(problem(401, 'UNAUTHORIZED'), { status: 401 }),
    ),
  );
}

const tokens = { access_token: 'access-login', token_type: 'Bearer', expires_in: 900 };

describe('Login [R1.4–R1.6, NFR-12]', () => {
  beforeEach(anonymous);

  it('muestra errores por campo sin llamar a la API', async () => {
    let calls = 0;
    server.use(http.post(`${API}/auth/login`, () => (calls++, HttpResponse.json(tokens))));
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Correo inválido')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Requerido')).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it('credenciales incorrectas: mensaje único', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json(problem(401, 'INVALID_CREDENTIALS'), { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Correo electrónico'), 'ana@treo.dev');
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
  });

  it('deshabilita el botón mientras envía y entra al resumen', async () => {
    let body: unknown;
    let platform: string | null = null;
    server.use(
      http.post(`${API}/auth/login`, async ({ request }) => {
        body = await request.json();
        platform = request.headers.get('X-Client-Platform');
        await new Promise((r) => setTimeout(r, 30));
        return HttpResponse.json(tokens);
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/login');
    await user.type(await screen.findByLabelText('Correo electrónico'), '  Ana@Treo.dev ');
    await user.type(screen.getByLabelText('Contraseña'), 'Demo12345!');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('button', { name: 'Entrando…' })).toBeDisabled();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(body).toEqual({ email: 'ana@treo.dev', password: 'Demo12345!' });
    expect(platform).toBe('web');
  });

  it('429: muestra cuánto esperar (Retry-After)', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json(problem(429, 'RATE_LIMITED'), {
          status: 429,
          headers: { 'Retry-After': '120' },
        }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Correo electrónico'), 'ana@treo.dev');
    await user.type(screen.getByLabelText('Contraseña'), 'x');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('en 120 segundos');
  });

  it('se puede completar solo con teclado', async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json(tokens)));
    const user = userEvent.setup();
    const { router } = renderApp('/login');
    await screen.findByLabelText('Correo electrónico');
    await user.tab();
    expect(screen.getByLabelText('Correo electrónico')).toHaveFocus();
    await user.keyboard('ana@treo.dev');
    await user.tab();
    expect(screen.getByLabelText('Contraseña')).toHaveFocus();
    await user.keyboard('Demo12345!{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('vuelve a la ruta protegida que se quería abrir', async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json(tokens)));
    const user = userEvent.setup();
    const { router } = renderApp('/beneficiaries');
    await user.type(await screen.findByLabelText('Correo electrónico'), 'ana@treo.dev');
    await user.type(screen.getByLabelText('Contraseña'), 'Demo12345!');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/beneficiaries'));
  });
});

describe('Registro [R1.1–R1.3]', () => {
  beforeEach(anonymous);

  it('valida la contraseña con la regla compartida (mínimo 10)', async () => {
    const user = userEvent.setup();
    renderApp('/register');
    await user.type(await screen.findByLabelText('Nombre completo'), 'Carla');
    await user.type(screen.getByLabelText('Correo electrónico'), 'carla@treo.dev');
    await user.type(screen.getByLabelText('Contraseña'), 'corta');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Mínimo 10 caracteres')).toBeInTheDocument();
  });

  it('409: muestra el error junto al correo', async () => {
    server.use(
      http.post(`${API}/auth/register`, () =>
        HttpResponse.json(problem(409, 'EMAIL_ALREADY_REGISTERED'), { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/register');
    await user.type(await screen.findByLabelText('Nombre completo'), 'Ana');
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@treo.dev');
    await user.type(screen.getByLabelText('Contraseña'), 'Demo12345!');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Ese correo ya está registrado.')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('aria-invalid', 'true');
  });

  it('al registrarse inicia sesión y entra al resumen', async () => {
    server.use(
      http.post(`${API}/auth/register`, () =>
        HttpResponse.json(
          { id: 'u', email: 'carla@treo.dev', full_name: 'Carla' },
          { status: 201 },
        ),
      ),
      http.post(`${API}/auth/login`, () => HttpResponse.json(tokens)),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/register');
    await user.type(await screen.findByLabelText('Nombre completo'), 'Carla');
    await user.type(screen.getByLabelText('Correo electrónico'), 'carla@treo.dev');
    await user.type(screen.getByLabelText('Contraseña'), 'Demo12345!');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
