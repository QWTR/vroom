import type { PersistedNavSession } from './types';

export const PERSISTED_NAV_SESSION_VERSION = 2 as const;

export function parsePersistedNavSession(raw: string | null): PersistedNavSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const savedAt = Number(value?.savedAt);
    if (!Number.isFinite(savedAt) || savedAt <= 0) return null;
    if (!value?.endLocation) return null;
    const version = value?.version === 2 ? 2 : 1;
    const tripSessionId = typeof value?.tripSessionId === 'string' && value.tripSessionId.trim()
      ? value.tripSessionId.trim()
      : null;
    return {
      ...value,
      version,
      tripSessionId,
      mode: value?.mode === 'freeDrive' ? 'freeDrive' : 'navigation',
      savedAt,
      currentStep: Math.max(0, Math.trunc(Number(value?.currentStep) || 0)),
      offroadPoints: Array.isArray(value?.offroadPoints) ? value.offroadPoints : [],
      isOffroadRoute: value?.isOffroadRoute === true,
      startLocation: value?.startLocation ?? null,
      endLocation: value.endLocation,
      navStartLoc: value?.navStartLoc ?? null,
      routeInfo: value?.routeInfo ?? null,
      routeSnapshot: value?.routeSnapshot ?? null,
    };
  } catch {
    return null;
  }
}

export function isFreshPersistedNavSession(
  session: PersistedNavSession | null,
  options: { tripSessionId?: string | null; now?: number; maxAgeMs: number },
): session is PersistedNavSession {
  if (!session || session.mode !== 'navigation') return false;
  const now = options.now ?? Date.now();
  if (now - session.savedAt > options.maxAgeMs) return false;
  if (
    session.version >= 2
    && options.tripSessionId
    && session.tripSessionId !== options.tripSessionId
  ) return false;
  return true;
}
