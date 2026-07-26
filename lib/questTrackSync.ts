import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

/**
 * Po zapisaniu Activity / checkpointu dystansu — odśwież postęp zadań Tor VROOM.
 * Serwer liczy km z Activity; sync musi iść nie tylko przy focusie Home.
 */
export async function syncQuestTrackAfterDistanceSave(): Promise<void> {
  try {
    const token =
      (await AsyncStorage.getItem('userToken')) ??
      (await AsyncStorage.getItem('token'));
    if (!token) return;
    await fetch(`${API_URL}/api/quest-track/current`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    /* ignore — questy odświeżą się przy następnym focusie Home */
  }
}
