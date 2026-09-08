import AsyncStorage from '@react-native-async-storage/async-storage';

let cachedToken: string | null | undefined;
let loading: Promise<string | null> | null = null;
let revision = 0;

export async function getAuthTokenCached(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  if (loading) return loading;
  const startedAt = revision;
  loading = (async () => {
    const token = (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
    if (startedAt !== revision) return cachedToken ?? null;
    cachedToken = token;
    return token;
  })().finally(() => { if (startedAt === revision) loading = null; });
  return loading;
}

export function setAuthTokenInMemory(token: string | null): void {
  revision += 1;
  loading = null;
  cachedToken = token;
}

export function clearAuthTokenMemory(): void {
  setAuthTokenInMemory(null);
}
