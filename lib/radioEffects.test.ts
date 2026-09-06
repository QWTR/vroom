import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audioMock = vi.hoisted(() => ({
  players: [] as any[],
  setAudioModeAsync: vi.fn(async () => {}),
  setIsAudioActiveAsync: vi.fn(async () => {}),
}));

vi.mock('expo-asset', () => ({
  Asset: { fromURI: () => ({ downloadAsync: async () => ({ localUri: null }) }) },
}));

vi.mock('expo-audio', () => ({
  setAudioModeAsync: audioMock.setAudioModeAsync,
  setIsAudioActiveAsync: audioMock.setIsAudioActiveAsync,
  createAudioPlayer: vi.fn(() => {
    const player = {
      isLoaded: false,
      volume: 0,
      play: vi.fn(),
      remove: vi.fn(),
      listener: null as null | ((status: { isLoaded: boolean }) => void),
      addListener: vi.fn((_event: string, listener: (status: { isLoaded: boolean }) => void) => {
        player.listener = listener;
        return { remove: vi.fn() };
      }),
    };
    audioMock.players.push(player);
    return player;
  }),
}));

import { playRadioCue } from './radioEffects';

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('radio cue playback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    audioMock.players.length = 0;
    audioMock.setAudioModeAsync.mockClear();
    audioMock.setIsAudioActiveAsync.mockClear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('activates the mixed audio session and waits until the cue is loaded', async () => {
    playRadioCue('convoyNotification', null, 77);
    await flushPromises();

    expect(audioMock.setAudioModeAsync).toHaveBeenCalledWith({
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: true,
    });
    expect(audioMock.setIsAudioActiveAsync).toHaveBeenCalledWith(true);
    expect(audioMock.players).toHaveLength(1);
    expect(audioMock.players[0].play).not.toHaveBeenCalled();

    audioMock.players[0].isLoaded = true;
    audioMock.players[0].listener?.({ isLoaded: true });
    await flushPromises();

    expect(audioMock.players[0].play).toHaveBeenCalledTimes(1);
    expect(audioMock.players[0].volume).toBe(1);
  });

  it('creates a fresh fallback player when the first load times out', async () => {
    playRadioCue('convoyNotification', null, 77);
    await flushPromises();

    await vi.advanceTimersByTimeAsync(1_800);
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();

    expect(audioMock.players).toHaveLength(2);
    expect(audioMock.players[0].remove).toHaveBeenCalledTimes(1);
    audioMock.players[1].isLoaded = true;
    audioMock.players[1].listener?.({ isLoaded: true });
    await flushPromises();

    expect(audioMock.players[1].play).toHaveBeenCalledTimes(1);
  });
});
