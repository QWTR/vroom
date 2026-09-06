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

  it('keeps marker subscriptions alive across a clear and immediate reseed', () => {
    const store = createLiveMapStore();
    store.setMeta({ id: 7, username: 'Zary', avatarUrl: null, online: true });
    store.setPosition(7, 52.0, 20.9);
    store.registerUserId(7);
    const metaListener = vi.fn();
    const positionListener = vi.fn();
    const unsubscribeMeta = store.subscribeMeta(7, metaListener);
    const unsubscribePosition = store.subscribePosition(7, positionListener);

    store.clear();
    store.setMeta({
      id: 7,
      username: 'Zary po reconnect',
      avatarUrl: null,
      online: true,
    });
    store.setPosition(7, 52.1, 21.0);

    expect(metaListener).toHaveBeenCalledTimes(2);
    expect(positionListener).toHaveBeenCalledTimes(2);
    unsubscribeMeta();
    unsubscribePosition();
  });

  it('keeps marker subscriptions alive when an offline user returns quickly', () => {
    const store = createLiveMapStore();
    store.setMeta({ id: 7, username: 'Zary', avatarUrl: null, online: true });
    store.setPosition(7, 52.1, 21.0);
    store.registerUserId(7);
    const positionListener = vi.fn();
    const unsubscribe = store.subscribePosition(7, positionListener);

    store.removeUser(7);
    store.setMeta({ id: 7, username: 'Zary', avatarUrl: null, online: true });
    store.setPosition(7, 52.2, 21.1);
    store.registerUserId(7);

    expect(positionListener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
