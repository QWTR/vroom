import { API_URL } from '../constants/config';

async function authGet(path: string, token: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Ta sama logika co baner / giełda — kilka endpointów na wypadek błędu /api/premium/status. */
export async function resolveBackendPremium(token: string): Promise<boolean> {
  try {
    const statusRes = await authGet('/api/premium/status', token);
    if (statusRes.ok) {
      const data = await statusRes.json();
      if (data?.isPremium) return true;
    }
  } catch { /* ignore */ }

  try {
    const meRes = await authGet('/api/profile/me', token);
    if (meRes.ok) {
      const me = await meRes.json();
      if (me?.isPremium) return true;
    }
  } catch { /* ignore */ }

  try {
    const metaRes = await authGet('/api/market/meta', token);
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta?.isPremium) return true;
    }
  } catch { /* ignore */ }

  return false;
}
