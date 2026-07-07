import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { ProfileMusicSource } from '../constants/profile';
import type { VroomkiSound } from '../lib/vroomkiTypes';

export async function fetchProfileMusicPreviewUrl(
  sourceType: ProfileMusicSource | string,
  trackId: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/profile/music-preview?sourceType=${encodeURIComponent(sourceType)}&trackId=${encodeURIComponent(trackId)}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.previewUrl === 'string' && json.previewUrl ? json.previewUrl : null;
  } catch {
    return null;
  }
}

function resolveVroomkiTrackId(sound: VroomkiSound): string | null {
  const sourceId = sound.sourceId?.trim();
  if (sourceId) return sourceId;
  if (sound.deezerTrackId) return sound.deezerTrackId;
  if (sound.itunesTrackId) return sound.itunesTrackId;
  if (sound.audiusTrackId) return sound.audiusTrackId;
  if (sound.spotifyTrackId) return sound.spotifyTrackId;
  return null;
}

export async function fetchVroomkiSoundPreviewUrl(sound: VroomkiSound): Promise<string | null> {
  const token =
    (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
  if (!token) return sound.audioUrl ?? null;

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
  const trackId = resolveVroomkiTrackId(sound);
  if (!sourceType || !trackId || sourceType === 'original') {
    return sound.audioUrl ?? null;
  }

  try {
    const res = await fetch(
      `${API_URL}/api/vroomki/sounds/preview?sourceType=${encodeURIComponent(sourceType)}&trackId=${encodeURIComponent(trackId)}`,
      { headers },
    );
    if (!res.ok) return sound.audioUrl ?? null;
    const json = await res.json();
    return typeof json?.audioUrl === 'string' && json.audioUrl ? json.audioUrl : sound.audioUrl ?? null;
  } catch {
    return sound.audioUrl ?? null;
  }
}
