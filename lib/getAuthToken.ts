import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bearer token — `userToken` (nowy login) lub `token` (legacy). */
export async function getAuthToken(): Promise<string | null> {
  return (
    (await AsyncStorage.getItem('userToken'))
    ?? (await AsyncStorage.getItem('token'))
  );
}
