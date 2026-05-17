import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export type ProfileClubSnapshot = {
  id: number;
  name: string;
  avatarUrl?: string | null;
  memberCount?: number;
  myRole?: string;
  myRank?: unknown;
} | null;

type ClubListener = (club: ProfileClubSnapshot) => void;
const listeners = new Set<ClubListener>();

/** Subscribe to club changes after join/leave (Account tab updates without full remount). */
export function onProfileClubUpdated(fn: ClubListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Refresh profile.club from server and notify subscribers. Call after join/leave/create/invite. */
export async function syncProfileClubFromServer(): Promise<ProfileClubSnapshot> {
  try {
    const token =
      (await AsyncStorage.getItem('userToken')) ??
      (await AsyncStorage.getItem('token'));
    if (!token) {
      listeners.forEach((fn) => fn(null));
      return null;
    }

    const res = await fetch(`${API_URL}/api/profile/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const club: ProfileClubSnapshot = data.club ?? null;

    const localRaw = await AsyncStorage.getItem('user');
    if (localRaw) {
      const old = JSON.parse(localRaw);
      await AsyncStorage.setItem(
        'user',
        JSON.stringify({
          ...old,
          ...data,
          avatarUrl: data.avatarUrl ?? old.avatarUrl,
          avatar: data.avatarUrl ?? old.avatar,
          club: undefined,
        }),
      );
    }

    listeners.forEach((fn) => fn(club));
    return club;
  } catch {
    return null;
  }
}
