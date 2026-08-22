import AsyncStorage from '@react-native-async-storage/async-storage';

let cachedToken: string | null | undefined;
let loading: Promise<string | null> | null = null;

export async function getAuthTokenCached(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (loading) return loading;
  loading = (async () => {
    const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
    cachedToken = token;
    return token;
  })().finally(() => { loading = null; });
  return loading;
}

export function setAuthTokenInMemory(token: string | null): void {
  cachedToken = token;
}

export function clearAuthTokenMemory(): void {
  cachedToken = undefined;
  loading = null;
}
