import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getMe } from '../api/endpoints';
import { qk } from '../api/queryKeys';
import { useAuth } from '../auth/AuthProvider';
import { TransferFlowProvider } from '../transfer/TransferFlow';

export function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: qk.me, queryFn: getMe });
  return (
    <>
      <a href="#main" className="skip-link">
        Saltar al contenido
      </a>
      <header className="app-header">
        <div className="container header-inner">
          <span className="brand">Treo</span>
          <nav aria-label="Principal">
            <ul className="nav">
              <li>
                <NavLink to="/" end>
                  Cuentas
                </NavLink>
              </li>
              <li>
                <NavLink to="/transfer">Transferir</NavLink>
              </li>
              <li>
                <NavLink to="/beneficiaries">Beneficiarios</NavLink>
              </li>
            </ul>
          </nav>
          {me.data && (
            <span className="user-name" title={me.data.email}>
              {me.data.full_name}
            </span>
          )}
          <button
            type="button"
            className="btn btn-link"
            onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
          >
            Cerrar sesión
          </button>
        </div>
      </header>
      <main id="main" className="container" tabIndex={-1}>
        <TransferFlowProvider>
          <Outlet />
        </TransferFlowProvider>
      </main>
    </>
  );
}

/** Contenedor de las pantallas públicas (login/registro). */
export function PublicLayout() {
  return (
    <main id="main" className="container narrow">
      <p className="brand brand-large">Treo</p>
      <Outlet />
    </main>
  );
}
