export type SmartStartFix = {
  latitude: number;
  longitude: number;
  timestamp: number;
  speedKmh: number;
  accuracyM: number | null;
};

export type SmartStartState = {
  version: 2;
  tripSessionId: string | null;
  phase: 'idle' | 'candidate' | 'driving' | 'paused';
  buffer: SmartStartFix[];
  reliableMovingFixes: number;
  stationarySince: number | null;
  stationaryOrigin: SmartStartFix | null;
  lastReliableAt: number | null;
  destinationFixes: number;
  pausedAt: number | null;
  finalizeAt: number | null;
  resumeMovingFixes: number;
};

export type SmartStartAction = 'none' | 'start' | 'pause' | 'resume' | 'finish' | 'discard_candidate';

export const initialSmartStartState = (tripSessionId: string | null = null): SmartStartState => ({
  version: 2,
  tripSessionId,
  phase: 'idle',
  buffer: [],
  reliableMovingFixes: 0,
  stationarySince: null,
  stationaryOrigin: null,
  lastReliableAt: null,
  destinationFixes: 0,
  pausedAt: null,
  finalizeAt: null,
  resumeMovingFixes: 0,
});

export function normalizeSmartStartState(value: unknown, tripSessionId: string | null): SmartStartState {
  const state = value && typeof value === 'object' ? value as Partial<SmartStartState> : null;
  if (state?.version !== 2) return initialSmartStartState(tripSessionId);
  if (tripSessionId && state.tripSessionId && state.tripSessionId !== tripSessionId) {
    return initialSmartStartState(tripSessionId);
  }
  return {
    ...initialSmartStartState(tripSessionId ?? state.tripSessionId ?? null),
    ...state,
    version: 2,
    tripSessionId: tripSessionId ?? state.tripSessionId ?? null,
    buffer: Array.isArray(state.buffer) ? state.buffer : [],
  } as SmartStartState;
}

function distanceMeters(a: SmartStartFix, b: SmartStartFix): number {
  const radius = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function evaluateSmartStart(
  rawPrevious: SmartStartState,
  fix: SmartStartFix,
  options: {
    navigating: boolean;
    now?: number;
    tripSessionId?: string | null;
    destination?: { latitude: number; longitude: number } | null;
    destinationKind?: 'route' | 'drop';
  } = { navigating: false },
): { state: SmartStartState; action: SmartStartAction } {
  const now = options.now ?? fix.timestamp;
  let previous = normalizeSmartStartState(rawPrevious, options.tripSessionId ?? rawPrevious?.tripSessionId ?? null);
  const reliable = Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude)
    && (fix.accuracyM == null || fix.accuracyM <= 65) && now - fix.timestamp <= 120_000;
  if (!reliable) {
    if ((previous.phase === 'driving' || previous.phase === 'paused') && previous.lastReliableAt != null && now - previous.lastReliableAt >= 20 * 60_000 && !options.navigating) {
      return { state: initialSmartStartState(previous.tripSessionId), action: 'finish' };
    }
    return { state: previous, action: 'none' };
  }
  if (previous.phase === 'idle') {
    if (fix.speedKmh < 12) return { state: previous, action: 'none' };
    return { state: { ...previous, phase: 'candidate', buffer: [fix], reliableMovingFixes: 1, lastReliableAt: now }, action: 'none' };
  }
  if (previous.phase === 'candidate') {
    const buffer = [...previous.buffer, fix].filter((item) => now - item.timestamp <= 2 * 60_000);
    if (!buffer.length || now - buffer[0].timestamp > 2 * 60_000) return { state: initialSmartStartState(previous.tripSessionId), action: 'discard_candidate' };
    const movingFixes = fix.speedKmh >= 12 ? previous.reliableMovingFixes + 1 : 0;
    if (movingFixes >= 2 && distanceMeters(buffer[0], fix) >= 250) {
      return { state: { ...previous, phase: 'driving', buffer, reliableMovingFixes: movingFixes, lastReliableAt: now }, action: 'start' };
    }
    return { state: { ...previous, buffer, reliableMovingFixes: movingFixes, lastReliableAt: now }, action: 'none' };
  }

  const destination = options.destination;
  if (options.navigating && options.destinationKind !== 'drop' && destination && Number.isFinite(destination.latitude) && Number.isFinite(destination.longitude)) {
    const destinationDistanceM = distanceMeters(fix, { ...fix, latitude: destination.latitude, longitude: destination.longitude });
    const destinationFixes = destinationDistanceM <= 70
      ? (Number(previous.destinationFixes) || 0) + 1
      : destinationDistanceM > 120 ? 0 : Number(previous.destinationFixes) || 0;
    if (destinationFixes >= 2) {
      return { state: initialSmartStartState(previous.tripSessionId), action: 'finish' };
    }
    previous = { ...previous, destinationFixes };
  }

  if (previous.phase === 'paused') {
    if (previous.finalizeAt != null && now >= previous.finalizeAt) {
      return { state: initialSmartStartState(previous.tripSessionId), action: 'finish' };
    }
    if (fix.speedKmh >= 3) {
      const movingFixes = previous.resumeMovingFixes + 1;
      if (movingFixes >= 2) {
        return {
          state: { ...previous, phase: 'driving', stationarySince: null, stationaryOrigin: null, pausedAt: null, finalizeAt: null, resumeMovingFixes: 0, lastReliableAt: now },
          action: 'resume',
        };
      }
      return { state: { ...previous, resumeMovingFixes: movingFixes, lastReliableAt: now }, action: 'none' };
    }
    return { state: { ...previous, resumeMovingFixes: 0, lastReliableAt: now }, action: 'none' };
  }

  if (fix.speedKmh >= 3) {
    return { state: { ...previous, stationarySince: null, stationaryOrigin: null, lastReliableAt: now }, action: 'none' };
  }
  const stationarySince = previous.stationarySince ?? now;
  const stationaryOrigin = previous.stationaryOrigin ?? fix;
  const stayedClose = distanceMeters(stationaryOrigin, fix) < 100;
  if (!stayedClose) {
    return { state: { ...previous, stationarySince: now, stationaryOrigin: fix, lastReliableAt: now }, action: 'none' };
  }
  if (now - stationarySince >= 10 * 60_000) {
    return {
      state: {
        ...previous,
        phase: 'paused',
        stationarySince,
        stationaryOrigin,
        lastReliableAt: now,
        pausedAt: now,
        finalizeAt: stationarySince + 40 * 60_000,
        resumeMovingFixes: 0,
      },
      action: 'pause',
    };
  }
  return { state: { ...previous, stationarySince, stationaryOrigin, lastReliableAt: now }, action: 'none' };
}
