import { describe, expect, it, vi } from 'vitest';
import {
  loadTextSizePreference,
  saveTextSizePreference,
  TEXT_SIZE_PREFERENCE_KEY,
  type PreferenceStorage,
} from './readabilityPreference';

function storageWith(value: string | null): PreferenceStorage {
  return {
    getItem: vi.fn(async () => value),
    setItem: vi.fn(async () => undefined),
  };
}

describe('readability preference persistence', () => {
  it('loads every valid preference', async () => {
    await expect(loadTextSizePreference(storageWith('compact'))).resolves.toBe('compact');
    await expect(loadTextSizePreference(storageWith('small'))).resolves.toBe('small');
    await expect(loadTextSizePreference(storageWith('standard'))).resolves.toBe('standard');
    await expect(loadTextSizePreference(storageWith('large'))).resolves.toBe('large');
    await expect(loadTextSizePreference(storageWith('veryLarge'))).resolves.toBe('veryLarge');
  });

  it('falls back safely for missing, corrupt or unreadable storage', async () => {
    await expect(loadTextSizePreference(storageWith(null))).resolves.toBe('standard');
    await expect(loadTextSizePreference(storageWith('huge'))).resolves.toBe('standard');
    await expect(loadTextSizePreference({
      getItem: vi.fn(async () => { throw new Error('storage'); }),
      setItem: vi.fn(),
    })).resolves.toBe('standard');
  });

  it('persists the normalized preference under the stable local key', async () => {
    const storage = storageWith(null);
    await expect(saveTextSizePreference(storage, 'large')).resolves.toBe('large');
    expect(storage.setItem).toHaveBeenCalledWith(TEXT_SIZE_PREFERENCE_KEY, 'large');
  });
});
