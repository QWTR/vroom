import AsyncStorage from '@react-native-async-storage/async-storage';

type SessionState = { status: 'loading' | 'authenticated' | 'guest'; navigationKey: number };
let state: SessionState = { status: 'loading', navigationKey: 0 };
let revision = 0;
const listeners = new Set<() => void>();

export const getAuthSessionState = () => state;
export function subscribeToAuthSession(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setAuthSessionAuthenticated(authenticated: boolean) {
  revision += 1;
  const status = authenticated ? 'authenticated' : 'guest';
  if (state.status === status) return;
  // Remount the navigator on sign-out so no previous account screen survives Back.
  state = { status, navigationKey: state.navigationKey + (status === 'guest' ? 1 : 0) };
  listeners.forEach((listener) => listener());
}

export async function hydrateAuthSession() {
  const startedAt = revision;
  const token = await AsyncStorage.getItem('userToken')
    .then(async (value) => value ?? await AsyncStorage.getItem('token'))
    .catch(() => null);
  if (startedAt === revision) setAuthSessionAuthenticated(Boolean(token));
}
