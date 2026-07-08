import { useEffect, useRef, useState } from 'react';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { VroomkiSound } from '../lib/vroomkiTypes';

async function readAuthToken(): Promise<string | null> {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

function resolveTrackId(sound: VroomkiSound): string | null {
  const sourceId = sound.sourceId?.trim();
  if (sourceId) return sourceId;
  if (sound.deezerTrackId) return sound.deezerTrackId;
  if (sound.itunesTrackId) return sound.itunesTrackId;
  if (sound.audiusTrackId) return sound.audiusTrackId;
  if (sound.spotifyTrackId) return sound.spotifyTrackId;
  return null;
}

async function fetchFreshAudioUrl(sound: VroomkiSound | null | undefined): Promise<string | null> {
  if (!sound) return null;
  const token = await readAuthToken();
  if (!token) return null;

  const headers = { Authorization: `Bearer ${token}` };

  if (sound.id) {
    try {
      const res = await fetch(`${API_URL}/api/vroomki/sounds/${sound.id}`, { headers });
      if (res.ok) {
        const json = await res.json();
        if (typeof json?.audioUrl === 'string' && json.audioUrl) return json.audioUrl;
      }
    } catch {
      /* try source fallback */
    }
  }

  const sourceType = sound.sourceType;
  const trackId = resolveTrackId(sound);
  if (!sourceType || !trackId || sourceType === 'original') return null;

  try {
    const res = await fetch(
      `${API_URL}/api/vroomki/sounds/preview?sourceType=${encodeURIComponent(sourceType)}&trackId=${encodeURIComponent(trackId)}`,
      { headers },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.audioUrl === 'string' && json.audioUrl ? json.audioUrl : null;
  } catch {
    return null;
  }
}

/** Creator-only preview: plays external soundtrack synced with video loop tick. */
export function useVroomkiSoundPlayback({
  active,
  sound,
  soundStartMs = 0,
  restartKey = 0,
  mediaLoopTick = 0,
}: {
  active: boolean;
  sound?: VroomkiSound | null;
  soundStartMs?: number;
  restartKey?: number | string;
  mediaLoopTick?: number;
}) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const loadGenRef = useRef(0);
  const canPlayRef = useRef(false);
  const soundStartMsRef = useRef(soundStartMs);
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState<string | null>(sound?.audioUrl ?? null);

  soundStartMsRef.current = soundStartMs;

  useEffect(() => {
    let cancelled = false;

    if (sound?.audioUrl) {
      setResolvedAudioUrl(sound.audioUrl);
      return () => {
        cancelled = true;
      };
    }

    if (!sound) {
      setResolvedAudioUrl(null);
      return undefined;
    }

    void fetchFreshAudioUrl(sound).then((url) => {
      if (!cancelled) setResolvedAudioUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [sound?.audioUrl, sound?.id, sound?.sourceType, sound?.sourceId, restartKey]);

  const canPlay = active && !!resolvedAudioUrl;
  canPlayRef.current = canPlay;

  const syncPlayback = async (player: Audio.Sound, shouldPlay: boolean) => {
    try {
      const status = await player.getStatusAsync();
      if (!status.isLoaded) return;

      if (shouldPlay) {
        await player.setPositionAsync(Math.max(0, soundStartMsRef.current));
        if (!status.isPlaying) await player.playAsync();
      } else if (status.isPlaying) {
        await player.pauseAsync();
      }
    } catch {
      // ignore transient playback errors
    }
  };

  const makeStatusHandler = (player: Audio.Sound) => (status: AVPlaybackStatus) => {
    if (!status.isLoaded || !status.didJustFinish) return;
    void player.setPositionAsync(Math.max(0, soundStartMsRef.current)).then(() => {
      if (canPlayRef.current) return player.playAsync();
      return undefined;
    }).catch(() => {});
  };

  const unloadPlayer = async () => {
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

  useEffect(() => {
    if (!mediaLoopTick) return;
    const player = soundRef.current;
    if (!player || !canPlayRef.current) return;
    void player.setPositionAsync(Math.max(0, soundStartMsRef.current)).catch(() => {});
  }, [mediaLoopTick]);

  useEffect(() => {
    let cancelled = false;
    const gen = ++loadGenRef.current;
    const url = resolvedAudioUrl;

    const load = async () => {
      if (!url) {
        await unloadPlayer();
        return;
      }

      if (soundRef.current && loadedUrlRef.current === url) {
        if (!cancelled && gen === loadGenRef.current) {
          await syncPlayback(soundRef.current, canPlayRef.current);
        }
        return;
      }

      await unloadPlayer();
      if (cancelled || gen !== loadGenRef.current) return;

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
            isLooping: false,
            positionMillis: Math.max(0, soundStartMsRef.current),
          },
        );
        player.setOnPlaybackStatusUpdate(makeStatusHandler(player));
        if (cancelled || gen !== loadGenRef.current) {
          await player.unloadAsync().catch(() => {});
          return;
        }
        soundRef.current = player;
        loadedUrlRef.current = url;
        if (canPlayRef.current) {
          await syncPlayback(player, true);
        }
      } catch (err) {
        console.warn('[vroomki] sound load failed:', url, err);
        if (!sound || cancelled) return;
        const freshUrl = await fetchFreshAudioUrl(sound);
        if (freshUrl && freshUrl !== url && !cancelled && gen === loadGenRef.current) {
          setResolvedAudioUrl(freshUrl);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [resolvedAudioUrl, restartKey, sound]);

  useEffect(() => {
    const player = soundRef.current;
    if (!player || loadedUrlRef.current !== resolvedAudioUrl) return;
    void syncPlayback(player, canPlay);
  }, [canPlay, soundStartMs, resolvedAudioUrl]);

  useEffect(() => {
    return () => {
      void unloadPlayer();
    };
  }, [restartKey]);

  return {
    hasExternalSound: !!resolvedAudioUrl,
  };
}
