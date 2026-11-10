import type { RouteObject } from 'react-router-dom';
import { Placeholder } from './pages/Placeholder';
import { DashboardPage } from './pages/DashboardPage';
import { MovementsPage } from './pages/MovementsPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

export const publicRoutes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
];

export const privateRoutes: RouteObject[] = [
  { path: '/', element: <DashboardPage /> },
  { path: '/accounts/:accountId/movements', element: <MovementsPage /> },
  { path: '/beneficiaries', element: <Placeholder title="Beneficiarios" /> },
  { path: '/transfer', element: <Placeholder title="Transferir" /> },
  { path: '*', element: <Placeholder title="Página no encontrada" /> },
];
