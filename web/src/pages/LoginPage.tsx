import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { loginSchema } from '@treo/shared';
import type { LoginInput } from '@treo/shared';
import { useAuth } from '../auth/AuthProvider';
import { messageFor } from '../api/errors';
import { TextField } from '../components/Field';
import { FormAlert } from '../components/States';

/** R1.4–R1.6: mismo mensaje para cualquier credencial incorrecta; 429 con Retry-After. */
export function LoginPage() {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), mode: 'onTouched' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      // Al quedar autenticado, RedirectIfAuthenticated lleva a la ruta de origen.
      await login(values);
    } catch (e) {
      setFormError(messageFor(e));
    }
  });

  return (
    <section aria-labelledby="page-title" className="card">
      <h1 id="page-title">Iniciar sesión</h1>
      <FormAlert>{formError}</FormAlert>
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="Correo electrónico"
          type="email"
          placeholder="user@treo.com"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Contraseña"
          placeholder="Contraseña"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p>
        ¿No tienes cuenta? <Link to="/register">Crea una</Link>
      </p>
    </section>
  );
}
