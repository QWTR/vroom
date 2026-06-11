import { API_URL } from '../constants/config';

const PREMIUM_FETCH_TIMEOUT_MS = 8_000;

async function authGet(path: string, token: string, signal?: AbortSignal): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PREMIUM_FETCH_TIMEOUT_MS);
  const onAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** Ta sama logika co baner / giełda — kilka endpointów na wypadek błędu /api/premium/status. */
export async function resolveBackendPremium(token: string, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;

  try {
    const statusRes = await authGet('/api/premium/status', token, signal);
    if (statusRes.ok) {
      const data = await statusRes.json();
      if (data?.isPremium) return true;
    }
  } catch { /* ignore */ }

  if (signal?.aborted) return false;

  try {
    const meRes = await authGet('/api/profile/me', token, signal);
    if (meRes.ok) {
      const me = await meRes.json();
      if (me?.isPremium) return true;
    }
  } catch { /* ignore */ }

  if (signal?.aborted) return false;

  try {
    const metaRes = await authGet('/api/market/meta', token, signal);
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta?.isPremium) return true;
    }
  } catch { /* ignore */ }

  return false;
}
