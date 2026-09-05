import { describe, expect, it, vi } from 'vitest';
import { downloadAndApplyUpdate, toUpdateProgressPercent } from '../lib/appUpdateCore';

describe('downloadAndApplyUpdate', () => {
  it('reloads only after Expo confirms a downloaded update', async () => {
    const reload = vi.fn(async () => {});
    const result = await downloadAndApplyUpdate({
      updateAlreadyPending: false,
      fetchUpdate: async () => ({ isNew: true, isRollBackToEmbedded: false }),
      reload,
      canReloadNow: () => true,
    });

    expect(result).toBe('restarted');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads an update that Expo already downloaded without fetching it twice', async () => {
    const fetchUpdate = vi.fn(async () => ({ isNew: false, isRollBackToEmbedded: false }));
    const reload = vi.fn(async () => {});
    const result = await downloadAndApplyUpdate({
      updateAlreadyPending: true,
      fetchUpdate,
      reload,
      canReloadNow: () => true,
    });

    expect(result).toBe('restarted');
    expect(fetchUpdate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('never reloads the old bundle when downloading fails', async () => {
    const reload = vi.fn(async () => {});
    await expect(downloadAndApplyUpdate({
      updateAlreadyPending: false,
      fetchUpdate: async () => { throw new Error('network failure'); },
      reload,
      canReloadNow: () => true,
    })).rejects.toThrow('network failure');

    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps a downloaded update pending while the app is in background', async () => {
    const reload = vi.fn(async () => {});
    const result = await downloadAndApplyUpdate({
      updateAlreadyPending: false,
      fetchUpdate: async () => ({ isNew: true, isRollBackToEmbedded: false }),
      reload,
      canReloadNow: () => false,
    });

    expect(result).toBe('downloaded');
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the server returns no launchable package', async () => {
    const reload = vi.fn(async () => {});
    const result = await downloadAndApplyUpdate({
      updateAlreadyPending: false,
      fetchUpdate: async () => ({ isNew: false, isRollBackToEmbedded: false }),
      reload,
      canReloadNow: () => true,
    });

    expect(result).toBe('not-available');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('toUpdateProgressPercent', () => {
  it('uses Expo progress and clamps it to a real percentage', () => {
    expect(toUpdateProgressPercent(undefined)).toBeNull();
    expect(toUpdateProgressPercent(0.42)).toBe(42);
    expect(toUpdateProgressPercent(1.4)).toBe(100);
    expect(toUpdateProgressPercent(-0.2)).toBe(0);
  });
});
