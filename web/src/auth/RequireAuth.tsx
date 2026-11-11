import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { LoadingState } from '../components/States';

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'checking') return <LoadingState label="Verificando sesión" />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

/** Login/registro: si ya hay sesión, ir a donde quería entrar el usuario (o al resumen). */
export function RedirectIfAuthenticated() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'checking') return <LoadingState label="Verificando sesión" />;
  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from.startsWith('/') ? from : '/'} replace />;
  }
  return <Outlet />;
}
