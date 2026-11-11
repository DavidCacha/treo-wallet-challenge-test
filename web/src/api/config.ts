const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

/** URL absoluta de un endpoint (las rutas relativas se resuelven contra el origen actual). */
export function apiUrl(path: string): string {
  const full = `${base.replace(/\/$/, '')}${path}`;
  return new URL(full, window.location.origin).toString();
}
