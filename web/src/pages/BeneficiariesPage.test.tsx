import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { API, beneficiaries, problem } from '../test/fixtures';
import { renderApp } from '../test/render';

// CLABE de ejemplo pública con dígito verificador correcto (verificada en packages/shared).
const VALID = '002010077777777771';
const WRONG_CHECK_DIGIT = '002010077777777772';

async function openForm() {
  const user = userEvent.setup();
  renderApp('/beneficiaries');
  await user.click(await screen.findByRole('button', { name: 'Agregar beneficiario' }));
  const form = screen.getByRole('form', { name: 'Nuevo beneficiario' });
  return { user, form };
}

describe('Beneficiarios [R3.1–R3.5, R3.7]', () => {
  it('lista los beneficiarios', async () => {
    renderApp('/beneficiaries');
    const list = await screen.findByRole('list', { name: 'Beneficiarios' });
    expect(within(list).getByText('Beto')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'Transferir a Beto' })).toHaveAttribute(
      'href',
      `/transfer?beneficiary=${beneficiaries[0]!.id}`,
    );
  });

  it('estado vacío', async () => {
    server.use(http.get(`${API}/beneficiaries`, () => HttpResponse.json({ data: [] })));
    renderApp('/beneficiaries');
    expect(await screen.findByText('Aún no tienes beneficiarios.')).toBeInTheDocument();
  });

  it('valida la CLABE en vivo y un dígito verificador erróneo bloquea el envío', async () => {
    let posts = 0;
    server.use(
      http.post(`${API}/beneficiaries`, () => {
        posts += 1;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const { user, form } = await openForm();
    const clabe = within(form).getByLabelText('CLABE');
    await user.type(clabe, '0020100');
    expect(within(form).getByText('7 de 18 dígitos.')).toBeInTheDocument();
    await user.type(clabe, '77777777772');
    expect(within(form).getByText('Dígito verificador incorrecto.')).toBeInTheDocument();

    await user.type(within(form).getByLabelText('Nombre'), 'Carla Pérez');
    await user.type(within(form).getByLabelText('Alias'), 'Carla');
    await user.click(within(form).getByRole('button', { name: 'Guardar beneficiario' }));
    expect(
      await within(form).findByText('El dígito verificador de la CLABE no es válido.'),
    ).toBeInTheDocument();
    expect(clabe).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toBe(0);
    expect(clabe).toHaveValue(WRONG_CHECK_DIGIT);
  });

  it('409 BENEFICIARY_ALREADY_EXISTS se muestra junto a la CLABE', async () => {
    server.use(
      http.post(`${API}/beneficiaries`, () =>
        HttpResponse.json(problem(409, 'BENEFICIARY_ALREADY_EXISTS'), { status: 409 }),
      ),
    );
    const { user, form } = await openForm();
    await user.type(within(form).getByLabelText('Nombre'), 'Carla Pérez');
    await user.type(within(form).getByLabelText('Alias'), 'Carla');
    await user.type(within(form).getByLabelText('CLABE'), VALID);
    expect(within(form).getByText('Dígito verificador correcto.')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Guardar beneficiario' }));
    expect(
      await within(form).findByText('Ya tienes un beneficiario con esa CLABE.'),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText('CLABE')).toHaveAttribute('aria-invalid', 'true');
  });

  it('422 CLABE_NOT_FOUND se muestra junto a la CLABE', async () => {
    server.use(
      http.post(`${API}/beneficiaries`, () =>
        HttpResponse.json(problem(422, 'CLABE_NOT_FOUND'), { status: 422 }),
      ),
    );
    const { user, form } = await openForm();
    await user.type(within(form).getByLabelText('Nombre'), 'Carla Pérez');
    await user.type(within(form).getByLabelText('Alias'), 'Carla');
    await user.type(within(form).getByLabelText('CLABE'), VALID);
    await user.click(within(form).getByRole('button', { name: 'Guardar beneficiario' }));
    expect(
      await within(form).findByText('La CLABE no pertenece a una cuenta de la plataforma.'),
    ).toBeInTheDocument();
  });

  it('alta exitosa: envía los datos, cierra el formulario y refresca la lista', async () => {
    let body: unknown;
    let created = false;
    server.use(
      http.post(`${API}/beneficiaries`, async ({ request }) => {
        body = await request.json();
        created = true;
        return HttpResponse.json(
          { id: 'b2', name: 'Carla Pérez', alias: 'Carla', clabe: VALID, created_at: '' },
          { status: 201 },
        );
      }),
      http.get(`${API}/beneficiaries`, () =>
        HttpResponse.json({
          data: created
            ? [
                ...beneficiaries,
                { id: 'b2', name: 'Carla Pérez', alias: 'Carla', clabe: VALID, created_at: '' },
              ]
            : beneficiaries,
        }),
      ),
    );
    const { user, form } = await openForm();
    await user.type(within(form).getByLabelText('Nombre'), ' Carla Pérez ');
    await user.type(within(form).getByLabelText('Alias'), 'Carla');
    await user.type(within(form).getByLabelText('CLABE'), VALID);
    await user.click(within(form).getByRole('button', { name: 'Guardar beneficiario' }));
    expect(await screen.findByText('Se agregó a Carla.')).toBeInTheDocument();
    expect(body).toEqual({ name: 'Carla Pérez', alias: 'Carla', clabe: VALID });
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Beneficiarios' })).getByText('Carla'),
      ).toBeInTheDocument(),
    );
  });
});
