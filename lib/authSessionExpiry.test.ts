import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  invalidateProfileCache: vi.fn(),
  syncRevenueCat: vi.fn(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      mocks.storage.set(key, value);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      keys.forEach((key) => mocks.storage.delete(key));
    }),
    removeItem: vi.fn(async (key: string) => {
      mocks.storage.delete(key);
    }),
  },
}));

vi.mock('../constants/config', () => ({ API_URL: 'https://api.test' }));
vi.mock('./cachedProfileMe', () => ({
  invalidateProfileMeClientCache: mocks.invalidateProfileCache,
}));
vi.mock('./revenueCatUserSync', () => ({
  syncRevenueCatLoginFromStorage: mocks.syncRevenueCat,
}));

import {
  createAuthSessionAwareFetch,
  expireSessionIfCurrent,
  getRequestBearerToken,
  isVroomApiRequest,
  subscribeToSessionExpired,
} from './authSessionExpiry';

describe('auth session expiry', () => {
  beforeEach(() => {
    mocks.storage.clear();
    mocks.invalidateProfileCache.mockClear();
    mocks.syncRevenueCat.mockClear();
  });

  it('reads bearer tokens case-insensitively', () => {
    expect(getRequestBearerToken('https://api.test/api/posts', {
      headers: { authorization: 'bearer abc.def' },
    })).toBe('abc.def');
  });

  it('recognizes only the configured API origin', () => {
    expect(isVroomApiRequest('https://api.test/api/posts')).toBe(true);
    expect(isVroomApiRequest('https://api.test.evil.example/api/posts')).toBe(false);
    expect(isVroomApiRequest('https://example.com/api/posts')).toBe(false);
  });

  it('clears the current session and emits one logout event on API 401', async () => {
    mocks.storage.set('userToken', 'expired-token');
    mocks.storage.set('token', 'expired-token');
    mocks.storage.set('user', '{"id":7}');
    mocks.storage.set('USER_IS_PREMIUM', 'true');
    const listener = vi.fn();
    const unsubscribe = subscribeToSessionExpired(listener);
    const baseFetch = vi.fn(async () => new Response('{}', { status: 401 }));
    const authFetch = createAuthSessionAwareFetch(baseFetch as typeof fetch);

    const response = await authFetch('https://api.test/api/posts', {
      headers: { Authorization: 'Bearer expired-token' },
    });

    expect(response.status).toBe(401);
    expect(mocks.storage.has('userToken')).toBe(false);
    expect(mocks.storage.has('token')).toBe(false);
    expect(mocks.storage.has('user')).toBe(false);
    expect(mocks.storage.get('USER_IS_PREMIUM')).toBe('false');
    expect(mocks.invalidateProfileCache).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not logout on 403, external APIs, or a response for an old token', async () => {
    mocks.storage.set('userToken', 'new-token');
    const listener = vi.fn();
    const unsubscribe = subscribeToSessionExpired(listener);

    const forbiddenFetch = createAuthSessionAwareFetch(
      vi.fn(async () => new Response('{}', { status: 403 })) as typeof fetch,
    );
    await forbiddenFetch('https://api.test/api/posts', {
      headers: { Authorization: 'Bearer new-token' },
    });

    const externalFetch = createAuthSessionAwareFetch(
      vi.fn(async () => new Response('{}', { status: 401 })) as typeof fetch,
    );
    await externalFetch('https://example.com/resource', {
      headers: { Authorization: 'Bearer new-token' },
    });

    await expireSessionIfCurrent('old-token');

    expect(mocks.storage.get('userToken')).toBe('new-token');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
