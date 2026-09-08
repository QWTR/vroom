import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ getItem: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

describe('navigation session', () => {
  beforeEach(() => { vi.resetModules(); storage.getItem.mockReset(); });
  it('starts closed, restores a saved session and discards navigation history on logout', async () => {
    const session = await import('./authSessionState');
    expect(session.getAuthSessionState().status).toBe('loading');
    storage.getItem.mockResolvedValue('token');
    await session.hydrateAuthSession();
    const previous = session.getAuthSessionState().navigationKey;
    expect(session.getAuthSessionState().status).toBe('authenticated');
    session.setAuthSessionAuthenticated(false);
    expect(session.getAuthSessionState()).toEqual({ status: 'guest', navigationKey: previous + 1 });
    session.setAuthSessionAuthenticated(true);
    expect(session.getAuthSessionState().navigationKey).toBe(previous + 1);
  });
  it('does not restore an old session when hydration finishes after logout', async () => {
    const session = await import('./authSessionState');
    let resolve!: (value: string) => void;
    storage.getItem.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const hydration = session.hydrateAuthSession();
    session.setAuthSessionAuthenticated(false);
    resolve('old-token');
    await hydration;
    expect(session.getAuthSessionState().status).toBe('guest');
  });
  it('fails closed on storage errors', async () => {
    const session = await import('./authSessionState');
    storage.getItem.mockRejectedValue(new Error('storage unavailable'));
    await session.hydrateAuthSession();
    expect(session.getAuthSessionState().status).toBe('guest');
  });
});
