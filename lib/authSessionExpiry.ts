import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import { invalidateProfileMeClientCache } from './cachedProfileMe';
import { syncRevenueCatLoginFromStorage } from './revenueCatUserSync';
import { clearAuthTokenMemory } from './api/authTokenMemory';

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type SessionExpiredListener = () => void;

const AUTH_STORAGE_KEYS = [
  'userToken',
  'token',
  'user',
  'app_settings',
  'needsUgcTerms',
  'open_post_id',
  'vroom_expo_push_token',
  'vroom_pending_notification_replies_v1',
] as const;

const INTERCEPTOR_MARKER = '__vroomAuthSessionExpiryInterceptor';
const listeners = new Set<SessionExpiredListener>();

let expiryInFlight: Promise<boolean> | null = null;
let pendingExpiryNotification = false;

function readHeader(headers: unknown, name: string): string | null {
  if (!headers) return null;

  const candidate = headers as any;
  if (typeof candidate.get === 'function') {
    const value = candidate.get(name);
    return typeof value === 'string' ? value : null;
  }

  if (Array.isArray(candidate)) {
    const pair = candidate.find(
      (entry: unknown) =>
        Array.isArray(entry)
        && String(entry[0]).toLowerCase() === name.toLowerCase(),
    );
    return pair ? String(pair[1]) : null;
  }

  if (typeof candidate === 'object') {
    const key = Object.keys(candidate).find(
      (headerName) => headerName.toLowerCase() === name.toLowerCase(),
    );
    if (key) return String(candidate[key]);
  }

  return null;
}

function requestHeaders(input: FetchInput, init?: FetchInit): any {
  if (init?.headers) return init.headers;
  if (input && typeof input === 'object' && 'headers' in input) {
    return (input as any).headers;
  }
  return undefined;
}

function requestUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === 'object' && 'url' in input) {
    return String((input as any).url ?? '');
  }
  return '';
}

export function getRequestBearerToken(input: FetchInput, init?: FetchInit): string | null {
  const authorization = readHeader(requestHeaders(input, init), 'authorization');
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function isVroomApiRequest(input: FetchInput): boolean {
  const url = requestUrl(input);
  const base = API_URL.replace(/\/+$/, '');
  return url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`);
}

function notifySessionExpired(): void {
  if (listeners.size === 0) {
    pendingExpiryNotification = true;
    return;
  }

  pendingExpiryNotification = false;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Jeden ekran nie może zablokować globalnego wylogowania.
    }
  }
}

/**
 * Usuwa sesję tylko wtedy, gdy 401 dotyczy tokenu, który nadal jest aktywny.
 * Chroni to przed wylogowaniem po spóźnionej odpowiedzi ze starej sesji.
 */
export async function expireSessionIfCurrent(requestToken: string): Promise<boolean> {
  if (expiryInFlight) return expiryInFlight;

  expiryInFlight = (async () => {
    const currentToken =
      (await AsyncStorage.getItem('userToken'))
      ?? (await AsyncStorage.getItem('token'));

    if (!currentToken || currentToken !== requestToken) return false;

    try {
      await AsyncStorage.multiRemove([...AUTH_STORAGE_KEYS]);
    } catch {
      await Promise.all(
        AUTH_STORAGE_KEYS.map((key) => AsyncStorage.removeItem(key).catch(() => {})),
      );
    }
    await AsyncStorage.setItem('USER_IS_PREMIUM', 'false').catch(() => {});
    clearAuthTokenMemory();
    void import('./query/client').then(({ clearPersistedQueryCaches }) => clearPersistedQueryCaches()).catch(() => {});
    void import('./socialQueue').then(({ clearSocialQueue }) => clearSocialQueue()).catch(() => {});
    void import('./sharedSocket').then(({ destroySharedSocket }) => destroySharedSocket()).catch(() => {});
    try {
      invalidateProfileMeClientCache();
    } catch {
      // Nawigacja do logowania ma zadziałać nawet przy błędzie czyszczenia cache.
    }

    // RevenueCat nie może opóźniać przejścia na ekran logowania.
    void syncRevenueCatLoginFromStorage().catch(() => {});
    notifySessionExpired();
    return true;
  })();

  try {
    return await expiryInFlight;
  } finally {
    expiryInFlight = null;
  }
}

export function createAuthSessionAwareFetch(baseFetch: typeof fetch): typeof fetch {
  const wrappedFetch = (async (input: FetchInput, init?: FetchInit) => {
    const requestToken = getRequestBearerToken(input, init);
    const response = await baseFetch(input, init);
    let unverifiedEmail = false;

    if (response.status === 403 && requestToken && isVroomApiRequest(input)) {
      const payload = await response.clone().json().catch(() => null);
      unverifiedEmail = payload?.code === 'EMAIL_NOT_VERIFIED';
    }

    if (
      (response.status === 401 || unverifiedEmail)
      && requestToken
      && isVroomApiRequest(input)
    ) {
      await expireSessionIfCurrent(requestToken);
    }

    return response;
  }) as typeof fetch;

  (wrappedFetch as any)[INTERCEPTOR_MARKER] = true;
  return wrappedFetch;
}

/** Instaluje jedną wspólną obsługę wygasłej sesji dla wszystkich wywołań fetch. */
export function installAuthSessionExpiryInterceptor(): void {
  const currentFetch = globalThis.fetch as typeof fetch & Record<string, unknown>;
  if (!currentFetch || currentFetch[INTERCEPTOR_MARKER]) return;
  globalThis.fetch = createAuthSessionAwareFetch(currentFetch);
}

export function subscribeToSessionExpired(listener: SessionExpiredListener): () => void {
  listeners.add(listener);

  if (pendingExpiryNotification) {
    pendingExpiryNotification = false;
    queueMicrotask(() => {
      if (listeners.has(listener)) listener();
    });
  }

  return () => {
    listeners.delete(listener);
  };
}

/** Czyści oczekujące zdarzenie po zapisaniu nowej, poprawnej sesji. */
export function markAuthSessionActive(): void {
  pendingExpiryNotification = false;
}
