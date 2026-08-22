import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('../../constants/config', () => ({ API_URL: 'https://api.test', REQUEST_TIMEOUT_MS: 10_000 }));
vi.mock('./authTokenMemory', () => ({
  getAuthTokenCached: vi.fn(async () => mocks.token),
}));

import { ApiRequestError, apiRequest } from './client';

describe('central API authentication modes', () => {
  beforeEach(() => {
    mocks.token = null;
    vi.unstubAllGlobals();
  });

  it('blocks authenticated requests before touching the network when the session is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/private')).rejects.toMatchObject<ApiRequestError>({ code: 'AUTH_TOKEN_MISSING' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows optional-auth reads and omits Authorization when logged out', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ source: 'admob' }),
      init,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/ads/serve', { auth: 'optional' })).resolves.toEqual({ source: 'admob' });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.has('Authorization')).toBe(false);
  });

  it('adds the in-memory token to optional-auth reads when available', async () => {
    mocks.token = 'cached-token';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ source: 'sponsored' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/ads/serve?slot=home', { auth: 'optional' });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer cached-token');
  });
});
