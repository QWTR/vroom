import { getAuthTokenCached } from './api/authTokenMemory';

/** Bearer token — `userToken` (nowy login) lub `token` (legacy). */
export async function getAuthToken(): Promise<string | null> {
  return getAuthTokenCached();
}
