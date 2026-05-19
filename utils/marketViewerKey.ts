import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'market_viewer_key';

/** Stały klucz urządzenia dla unikalnych wyświetleń giełdy (goście / przed logowaniem). */
export async function getMarketViewerKey(): Promise<string> {
  let key = await AsyncStorage.getItem(STORAGE_KEY);
  if (!key) {
    key = `${Date.now()}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;
    await AsyncStorage.setItem(STORAGE_KEY, key);
  }
  return key;
}
