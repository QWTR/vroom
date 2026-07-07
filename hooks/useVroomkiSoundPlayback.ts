import { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';
import type { VroomkiSound } from '../lib/vroomkiTypes';

export function useVroomkiSoundPlayback({
  active,
  sound,
  soundStartMs = 0,
  restartKey = 0,
  waitForMedia = false,
  mediaReady = true,
}: {
  active: boolean;
  sound?: VroomkiSound | null;
  soundStartMs?: number;
  restartKey?: number | string;
  waitForMedia?: boolean;
  mediaReady?: boolean;
}) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const loadGenRef = useRef(0);
  const canPlayRef = useRef(false);

  const canPlay = active && !!sound?.audioUrl && (!waitForMedia || mediaReady);
  canPlayRef.current = canPlay;

  const syncPlayback = async (player: Audio.Sound, shouldPlay: boolean) => {
    try {
      const status = await player.getStatusAsync();
      if (!status.isLoaded) return;

      if (shouldPlay) {
        await player.setPositionAsync(Math.max(0, soundStartMs));
        if (!status.isPlaying) await player.playAsync();
      } else if (status.isPlaying) {
        await player.pauseAsync();
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let cancelled = false;
    const gen = ++loadGenRef.current;

    const unload = async () => {
      const current = soundRef.current;
      soundRef.current = null;
      loadedUrlRef.current = null;
      if (!current) return;
      try {
        await current.stopAsync();
      } catch {}
      try {
        await current.unloadAsync();
      } catch {}
    };

    const load = async () => {
      const url = sound?.audioUrl;
      if (!active || !url) {
        await unload();
        return;
      }

      if (soundRef.current && loadedUrlRef.current === url) {
        if (!cancelled && gen === loadGenRef.current) {
          await syncPlayback(soundRef.current, canPlayRef.current);
        }
        return;
      }

      await unload();
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });
        const { sound: player } = await Audio.Sound.createAsync(
          { uri: url },
          {
            shouldPlay: false,
            isLooping: true,
            positionMillis: Math.max(0, soundStartMs),
          },
        );
        if (cancelled || gen !== loadGenRef.current) {
          await player.unloadAsync().catch(() => {});
          return;
        }
        soundRef.current = player;
        loadedUrlRef.current = url;
        if (canPlayRef.current) {
          await syncPlayback(player, true);
        }
      } catch {
        // ignore
      }
    };

    void load();
    return () => {
      cancelled = true;
      void unload();
    };
  }, [active, sound?.audioUrl, soundStartMs, restartKey]);

  useEffect(() => {
    const player = soundRef.current;
    if (!player || loadedUrlRef.current !== sound?.audioUrl) return;
    void syncPlayback(player, canPlay);
  }, [canPlay, soundStartMs, sound?.audioUrl]);

  return {
    hasExternalSound: !!sound?.audioUrl,
  };
}
