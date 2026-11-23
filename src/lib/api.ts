// In-memory session token (never stored in localStorage/sessionStorage for security)
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export async function apiFetch<T = unknown>(url: string, options: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs = 6000, signal, ...restOptions } = options;
  const headers = new Headers(restOptions.headers || {});
  if (!headers.has('Content-Type') && restOptions.body && !(restOptions.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'AmarPOS');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const method = String(restOptions.method || 'GET').toUpperCase();

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const res = await fetch(url, { ...restOptions, headers, signal: controller.signal, credentials: 'include' });
    if (timer) clearTimeout(timer);

    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : await res.text();

    if (!res.ok) {
      const errMsg = typeof data === 'object' && data && 'error' in data ? String((data as { error: string }).error) : `Request failed (${res.status})`;
      throw new Error(errMsg);
    }

    if (
      typeof window !== 'undefined' &&
      method !== 'GET' &&
      method !== 'HEAD' &&
      !url.startsWith('/api/auth/') &&
      !url.startsWith('/api/sheets/')
    ) {
      window.dispatchEvent(new CustomEvent('amarpos:tx-completed', { detail: { url, method } }));
    }

    return data as T;
  } catch (err) {
    if (timer) clearTimeout(timer);
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms (Offline / Server unreachable)`);
    }
    throw err;
  }
}

export async function downloadCsvBackup(
  dataset: 'pnl' | 'sales' | 'purchases' | 'expenses' | 'products' | 'customers'
): Promise<void> {
  const headers = new Headers({ 'X-Requested-With': 'AmarPOS' });
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  const res = await fetch(`/api/backup/csv?dataset=${encodeURIComponent(dataset)}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`CSV download failed (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const nameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = nameMatch ? nameMatch[1] : `AmarPOS-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
