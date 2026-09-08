import { expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ getItem: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

it('cannot resurrect a token from a storage read that finishes after logout', async () => {
  const memory = await import('./authTokenMemory');
  let resolve!: (value: string) => void;
  storage.getItem.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
  const read = memory.getAuthTokenCached();
  memory.clearAuthTokenMemory();
  resolve('old-account-token');
  expect(await read).toBeNull();
  expect(await memory.getAuthTokenCached()).toBeNull();
  memory.setAuthTokenInMemory('new-account-token');
  expect(await memory.getAuthTokenCached()).toBe('new-account-token');
});
