import { describe, expect, it, vi } from 'vitest';
import { emitNitroWalletUpdate, subscribeNitroWallet } from './nitroWalletEvents';

describe('Nitro wallet updates', () => {
  it('broadcasts one normalized balance to profile and shop listeners', () => {
    const profile = vi.fn();
    const shop = vi.fn();
    const unsubscribeProfile = subscribeNitroWallet(profile);
    const unsubscribeShop = subscribeNitroWallet(shop);

    emitNitroWalletUpdate({ nitroBalance: 75.9 });

    expect(profile).toHaveBeenCalledWith({ nitroBalance: 75 });
    expect(shop).toHaveBeenCalledWith({ nitroBalance: 75 });
    unsubscribeProfile();
    unsubscribeShop();
  });

  it('ignores an invalid stale balance', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNitroWallet(listener);
    emitNitroWalletUpdate({ nitroBalance: Number.NaN });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
