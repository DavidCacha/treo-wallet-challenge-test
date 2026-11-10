import { http, HttpResponse } from 'msw';
import { accounts, API, beneficiaries, me } from './fixtures';

/** Handlers por defecto: usuario demo autenticado por cookie. Cada prueba los sobreescribe. */
export const handlers = [
  http.post(`${API}/auth/refresh`, () =>
    HttpResponse.json({ access_token: 'access-1', token_type: 'Bearer', expires_in: 900 }),
  ),
  http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${API}/me`, () => HttpResponse.json(me)),
  http.get(`${API}/accounts`, () => HttpResponse.json({ data: accounts })),
  http.get(`${API}/beneficiaries`, () => HttpResponse.json({ data: beneficiaries })),
  http.get(`${API}/accounts/:id/movements`, () =>
    HttpResponse.json({ data: [], next_cursor: null }),
  ),
];
