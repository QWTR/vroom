import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const VROOMKI_CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}vroomki-videos/`;

/** Klucze, które po krytycznym wyjątku często psują UI (Rolki / animacje) — bez tokena sesji. */
const SAFE_RESET_KEYS = [
  'vroom.vroomkiVideoCache.index.v1',
  'vroomki_last_published_post_id',
  'app_animations_cache_v2',
  'open_post_id',
] as const;

/**
 * Selektywne czyszczenie zepsutego cache po Error Boundary.
 * Nie usuwa userToken / token / user — sesja zostaje.
 */
export async function resetCriticalAppCache(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...SAFE_RESET_KEYS]);
  } catch {
    /* ignore */
  }

  try {
    if (VROOMKI_CACHE_DIR) {
      await FileSystem.deleteAsync(VROOMKI_CACHE_DIR, { idempotent: true });
    }
  } catch {
    /* ignore */
  }
}

/** Pełny reset cache wideo Vroomki (lokalny boundary Rolek). */
export async function resetVroomkiVideoCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem('vroom.vroomkiVideoCache.index.v1');
  } catch {
    /* ignore */
  }
  try {
    if (VROOMKI_CACHE_DIR) {
      await FileSystem.deleteAsync(VROOMKI_CACHE_DIR, { idempotent: true });
    }
  } catch {
    /* ignore */
  }
}
