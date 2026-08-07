export interface ApiClientConfig {
  /** Absolute or relative base URL, e.g. 'https://bandwagon.up.railway.app/api' or '/api'. */
  baseUrl: string;
  /** Reads the current auth token. May be async (e.g. SecureStore) or sync (e.g. localStorage). */
  getToken: () => string | null | Promise<string | null>;
}

export interface ApiClient {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body: unknown) => Promise<T>;
  put: <T>(path: string, body: unknown) => Promise<T>;
  del: <T>(path: string, body?: unknown) => Promise<T>;
}

export function createApiClient({ baseUrl, getToken }: ApiClientConfig): ApiClient {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const isFormData = options.body instanceof FormData;
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'PUT', body: body instanceof FormData ? body : JSON.stringify(body) }),
    del: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'DELETE', ...(body !== undefined && { body: JSON.stringify(body) }) }),
  };
}
