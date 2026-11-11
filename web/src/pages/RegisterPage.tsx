import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { registerSchema } from '@treo/shared';
import type { RegisterInput } from '@treo/shared';
import * as api from '../api/endpoints';
import { isApiError, messageFor } from '../api/errors';
import { useAuth } from '../auth/AuthProvider';
import { TextField } from '../components/Field';
import { FormAlert } from '../components/States';

/** R1.1–R1.3: mismas reglas que la API (registerSchema compartido); 409 junto al correo. */
export function RegisterPage() {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema), mode: 'onTouched' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.register(values);
    } catch (e) {
      if (isApiError(e, 'EMAIL_ALREADY_REGISTERED')) {
        setError('email', { message: messageFor(e) }, { shouldFocus: true });
      } else if (isApiError(e, 'VALIDATION_ERROR')) {
        for (const err of e.problem?.errors ?? []) {
          if (err.path === 'email' || err.path === 'full_name' || err.path === 'password') {
            setError(err.path, { message: err.message });
          }
        }
        setFormError(messageFor(e));
      } else {
        setFormError(messageFor(e));
      }
      return;
    }
    try {
      await login({ email: values.email, password: values.password });
    } catch (e) {
      setFormError(`Tu cuenta se creó, pero no pudimos iniciar sesión: ${messageFor(e)}`);
    }
  });

  return (
    <section aria-labelledby="page-title" className="card">
      <h1 id="page-title">Crear cuenta</h1>
      <FormAlert>{formError}</FormAlert>
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="Nombre completo"
          autoComplete="name"
          placeholder='Nombre Completo'
          error={errors.full_name?.message}
          {...register('full_name')}
        />
        <TextField
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder='user@treo.com'
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Contraseña"
          type="password"
          placeholder='Contraseña'
          autoComplete="new-password"
          hint="Mínimo 10 caracteres."
          error={errors.password?.message}
          {...register('password')}
        />
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>
      <p>
        ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
      </p>
    </section>
  );
}
