import type { ReactNode } from 'react';
import { messageFor } from '../api/errors';

export function LoadingState({ label = 'Cargando', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = 'No pudimos cargar la información',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="state state-error" role="alert">
      <p className="state-title">{title}</p>
      <p>{messageFor(error)}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

/** Mensaje de error dentro de un formulario (anunciado por lectores de pantalla). */
export function FormAlert({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="form-alert" role="alert">
      {children}
    </div>
  );
}
