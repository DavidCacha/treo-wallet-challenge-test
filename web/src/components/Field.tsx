import { forwardRef, useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

interface BaseProps {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
}

function describedBy(hintId: string, errorId: string, hint: unknown, error: unknown) {
  return [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
}

/** Campo con `label` asociado, ayuda y error enlazados por aria-describedby (NFR-12). */

export const TextField = forwardRef<
  HTMLInputElement,
  BaseProps & InputHTMLAttributes<HTMLInputElement>
>(function TextField({ label, error, hint, type, id, ...props }, ref) {
  const [showPassword, setShowPassword] = useState(false);
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const isPassword = type === 'password';

  const input = (
    <input
      ref={ref}
      id={inputId}
      type={isPassword && showPassword ? 'text' : type}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(hintId, errorId, hint, error)}
      {...props}
    />
  );

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>

      {isPassword ? (
        <div className="field-password-wrap">
          {input}
          <button
            type="button"
            className="field-password-toggle"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={showPassword}
          >
            {showPassword ? '◉' : '◎'}
          </button>
        </div>
      ) : (
        input
      )}

      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
});

export const SelectField = forwardRef<
  HTMLSelectElement,
  BaseProps & SelectHTMLAttributes<HTMLSelectElement>
>(function SelectField({ label, error, hint, id, children, ...props }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <select
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hintId, errorId, hint, error)}
        {...props}
      >
        {children}
      </select>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
});
