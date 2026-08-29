export type SmartStartFix = {
  latitude: number;
  longitude: number;
  timestamp: number;
  speedKmh: number;
  accuracyM: number | null;
};

export type SmartStartState = {
  phase: 'idle' | 'candidate' | 'driving';
  buffer: SmartStartFix[];
  reliableMovingFixes: number;
  stationarySince: number | null;
  stationaryOrigin: SmartStartFix | null;
  lastReliableAt: number | null;
};

export type SmartStartAction = 'none' | 'start' | 'finish' | 'discard_candidate';

export const initialSmartStartState = (): SmartStartState => ({
  phase: 'idle', buffer: [], reliableMovingFixes: 0, stationarySince: null, stationaryOrigin: null, lastReliableAt: null,
});

function distanceMeters(a: SmartStartFix, b: SmartStartFix): number {
  const radius = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function evaluateSmartStart(
  previous: SmartStartState,
  fix: SmartStartFix,
  options: { navigating: boolean; now?: number } = { navigating: false },
): { state: SmartStartState; action: SmartStartAction } {
  const now = options.now ?? fix.timestamp;
  const reliable = Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude)
    && (fix.accuracyM == null || fix.accuracyM <= 65) && now - fix.timestamp <= 120_000;
  if (!reliable) {
    if (previous.phase === 'driving' && previous.lastReliableAt != null && now - previous.lastReliableAt >= 20 * 60_000 && !options.navigating) {
      return { state: initialSmartStartState(), action: 'finish' };
    }
    return { state: previous, action: 'none' };
  }
  if (previous.phase === 'idle') {
    if (fix.speedKmh < 12) return { state: previous, action: 'none' };
    return { state: { ...previous, phase: 'candidate', buffer: [fix], reliableMovingFixes: 1, lastReliableAt: now }, action: 'none' };
  }
  if (previous.phase === 'candidate') {
    const buffer = [...previous.buffer, fix].filter((item) => now - item.timestamp <= 2 * 60_000);
    if (!buffer.length || now - buffer[0].timestamp > 2 * 60_000) return { state: initialSmartStartState(), action: 'discard_candidate' };
    const movingFixes = fix.speedKmh >= 12 ? previous.reliableMovingFixes + 1 : 0;
    if (movingFixes >= 2 && distanceMeters(buffer[0], fix) >= 250) {
      return { state: { ...previous, phase: 'driving', buffer, reliableMovingFixes: movingFixes, lastReliableAt: now }, action: 'start' };
    }
    return { state: { ...previous, buffer, reliableMovingFixes: movingFixes, lastReliableAt: now }, action: 'none' };
  }
  if (fix.speedKmh >= 3) {
    return { state: { ...previous, stationarySince: null, stationaryOrigin: null, lastReliableAt: now }, action: 'none' };
  }
  const stationarySince = previous.stationarySince ?? now;
  const stationaryOrigin = previous.stationaryOrigin ?? fix;
  const stayedClose = distanceMeters(stationaryOrigin, fix) < 100;
  if (!options.navigating && stayedClose && now - stationarySince >= 10 * 60_000) {
    return { state: initialSmartStartState(), action: 'finish' };
  }
  return { state: { ...previous, stationarySince, stationaryOrigin, lastReliableAt: now }, action: 'none' };
}
