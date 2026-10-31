import { demoCsv, demoEnabled, demoRequest } from './demo';
import { ApiError } from './errors';

export { ApiError };

/**
 * Typed-ish API client. Cookies are HTTP-only; we never store tokens in JS.
 *
 * In demo mode (GitHub Pages) the very same calls are served by `./demo`, an
 * in-browser backend: no request leaves the page, no database is involved and
 * every record lives in localStorage only.
 */

let locale: 'fr' | 'en' = (localStorage.getItem('mc.locale') as 'fr' | 'en') ?? 'fr';
export function setApiLocale(l: 'fr' | 'en') {
  locale = l;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (demoEnabled) {
    if (body instanceof FormData) {
      throw new ApiError(501, 'DEMO_UNSUPPORTED', 'Upload indisponible en démonstration');
    }
    return demoRequest<T>(method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path, body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: {
        'x-locale': locale,
        ...(body !== undefined && !(body instanceof FormData)
          ? { 'content-type': 'application/json' }
          : {}),
      },
      body:
        body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', locale === 'fr' ? 'Serveur injoignable.' : 'Server unreachable.');
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let code = 'INTERNAL_ERROR';
    let message = `${res.status}`;
    let details: unknown;
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
      code = data.error?.code ?? code;
      message = data.error?.message ?? message;
      details = data.error?.details;
    }
    throw new ApiError(res.status, code, message, details);
  }

  if (contentType.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

/** Opens a report/export in a new tab (PDF inline) or downloads CSV. */
export async function downloadExport(path: string, filename: string, format: 'csv' | 'pdf') {
  if (demoEnabled) {
    // The browser demo can compute CSV exactly. A real PDF is produced by the
    // server (PDFKit), so in demo mode the button opens the print dialog and the
    // user can "Save as PDF" — this fact is stated in the demo banner.
    const { text, mode } = demoCsv(path, format);
    if (mode === 'print' || !text) {
      window.print();
      return;
    }
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }

  const res = await fetch(`/api${path}${path.includes('?') ? '&' : '?'}format=${format}`, {
    credentials: 'include',
    headers: { 'x-locale': locale },
  });
  if (!res.ok) throw new ApiError(res.status, 'EXPORT_FAILED', 'Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (format === 'pdf') {
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
