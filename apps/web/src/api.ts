/** Typed-ish API client. Cookies are HTTP-only; we never store tokens in JS. */
export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let locale: 'fr' | 'en' = (localStorage.getItem('mc.locale') as 'fr' | 'en') ?? 'fr';
export function setApiLocale(l: 'fr' | 'en') {
  locale = l;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

/** Opens a report/export in a new tab (PDF inline) or downloads CSV. */
export async function downloadExport(path: string, filename: string, format: 'csv' | 'pdf') {
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
