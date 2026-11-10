import type { RouteObject } from 'react-router-dom';
import { Placeholder } from './pages/Placeholder';

export const publicRoutes: RouteObject[] = [
  { path: '/login', element: <Placeholder title="Iniciar sesión" /> },
  { path: '/register', element: <Placeholder title="Crear cuenta" /> },
];

export const privateRoutes: RouteObject[] = [
  { path: '/', element: <Placeholder title="Mis cuentas" /> },
  { path: '/accounts/:accountId/movements', element: <Placeholder title="Movimientos" /> },
  { path: '/beneficiaries', element: <Placeholder title="Beneficiarios" /> },
  { path: '/transfer', element: <Placeholder title="Transferir" /> },
  { path: '*', element: <Placeholder title="Página no encontrada" /> },
];
