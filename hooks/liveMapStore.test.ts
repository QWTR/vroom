import { describe, expect, it, vi } from 'vitest';
import { createLiveMapStore } from './liveMapStore';

describe('liveMapStore marker identity subscriptions', () => {
  it('notifies a marker for identity changes but not transport-only metadata', () => {
    const store = createLiveMapStore();
    store.setMeta({
      id: 7,
      username: 'Zary',
      avatarUrl: 'old.png',
      online: true,
      serverAt: 100,
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribeMeta(7, listener);

    store.setMeta({
      id: 7,
      username: 'Zary',
      avatarUrl: 'old.png',
      online: true,
      serverAt: 200,
    });
    expect(listener).not.toHaveBeenCalled();

    store.setMeta({
      id: 7,
      username: 'Zary',
      avatarUrl: 'new.png',
      avatarFrameUrl: 'nitro-frame.gif',
      isPremium: true,
      online: true,
      serverAt: 200,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
