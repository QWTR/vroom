export function resolveOnlineCountPayload(payload: {
  online?: unknown;
  activeInApp?: unknown;
}): number | null {
  const online = normalizeCount(payload.online);
  if (online != null) return online;
  const activeInApp = normalizeCount(payload.activeInApp);
  if (activeInApp != null) return activeInApp;
  return null;
}

function normalizeCount(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}
