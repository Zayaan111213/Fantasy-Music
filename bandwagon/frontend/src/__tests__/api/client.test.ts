import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../../api/client';

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockClear();
  vi.stubGlobal('fetch', mockFetch);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockOkResponse(body: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function mockErrorResponse(status: number, body: { error: string }) {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('api.get', () => {
  it('calls fetch with the correct URL', async () => {
    mockOkResponse({ data: 'value' });
    await api.get('/auth/me');
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/me', expect.any(Object));
  });

  it('includes Authorization header when token exists in localStorage', async () => {
    localStorage.setItem('bw_token', 'my-token');
    mockOkResponse({});
    await api.get('/leagues');
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-token');
  });

  it('omits Authorization header when no token in localStorage', async () => {
    mockOkResponse({});
    await api.get('/leagues');
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });

  it('returns the parsed JSON body on success', async () => {
    mockOkResponse({ leagues: [] });
    const result = await api.get<{ leagues: unknown[] }>('/leagues');
    expect(result).toEqual({ leagues: [] });
  });

  it('throws an Error with the server error message on non-ok response', async () => {
    mockErrorResponse(401, { error: 'Unauthorized' });
    await expect(api.get('/leagues')).rejects.toThrow('Unauthorized');
  });

  it('throws an Error with HTTP status when error body cannot be parsed', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error('parse fail')),
    });
    await expect(api.get('/leagues')).rejects.toThrow('Network error');
  });
});

describe('api.post', () => {
  it('sends a POST request with JSON body and Content-Type header', async () => {
    mockOkResponse({ id: '123' });
    await api.post('/leagues', { name: 'My League' });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.body).toBe(JSON.stringify({ name: 'My League' }));
  });

  it('omits Content-Type when body is FormData', async () => {
    mockOkResponse({});
    const fd = new FormData();
    fd.append('file', new Blob(['data']));
    await api.post('/upload', fd);
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Content-Type']).toBeUndefined();
  });
});

describe('api.put', () => {
  it('sends a PUT request with JSON body', async () => {
    mockOkResponse({ ok: true });
    await api.put('/leagues/123', { name: 'Updated' });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('PUT');
    expect(options.body).toBe(JSON.stringify({ name: 'Updated' }));
  });
});

describe('api.del', () => {
  it('sends a DELETE request', async () => {
    mockOkResponse({});
    await api.del('/leagues/123');
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('DELETE');
  });
});
