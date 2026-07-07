export type ResumeRecoverySource = 'snapshot' | 'native' | 'expo';
export type ResumeRecoveryPhase = 'idle' | 'restoringFromNative' | 'waitingForFreshFix' | 'roadLocking' | 'live';
export type ResumeFixSourceKind = 'live' | 'lastKnown' | 'buffer' | string;
export type ResumeFixFreshness = 'fresh' | 'seed' | 'stale';

export type ResumeRecoveryState = {
  active: boolean;
  phase: ResumeRecoveryPhase;
  startedAt: number;
  bgPauseMs: number;
  seedFixTimestamp: number;
  acceptedForegroundFixes: number;
  firstFreshFixAccepted: boolean;
  lastReliableSpeedKmh: number;
  hardSnapConsumed: boolean;
  lastResumeRoadLockAt: number;
  generation: number;
  lastAcceptedSource: ResumeRecoverySource | null;
  lastAcceptedSourceAt: number;
  lastExpoSeenAt: number;
  lastExpoAcceptedAt: number;
  lastNativeSeenAt: number;
  lastNativeAcceptedAt: number;
};

export type ResumeFixLike = {
  latitude: number;
  longitude: number;
  timestamp?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  source?: ResumeFixSourceKind | null;
  receivedAt?: number | null;
  elapsedRealtimeNanos?: number | null;
  isSeed?: boolean | null;
};

export type PreviousRawFixLike = {
  lat: number;
  lng: number;
  at: number;
};

export type ResumeSpeedResolution = {
  speedKmh: number;
  speedMs: number | null;
  reliable: boolean;
  source: 'native' | 'derived' | 'held' | 'none';
  capped: boolean;
};

const DEFAULT_RESUME_SPEED_RISE_CAP_KMH = 28;
const DEFAULT_RESUME_DT_MIN_MS = 500;
const DEFAULT_RESUME_DT_MAX_MS = 4500;
const DEFAULT_NATIVE_SPEED_MAX_KMH = 180;
const DEFAULT_MAX_SPEED_KMH = 9999;
export const RESUME_UI_FRESH_FIX_MAX_AGE_MS = 15_000;
export const RESUME_UI_SEED_FIX_MAX_AGE_MS = 120_000;
const DEFAULT_RESUME_MAX_ACCURACY_M = 85;

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const earthRadiusM = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const lat1 = aLat * toRad;
  const lat2 = bLat * toRad;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat
    + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function createResumeRecoveryState(): ResumeRecoveryState {
  return {
    active: false,
    phase: 'idle',
    startedAt: 0,
    bgPauseMs: 0,
    seedFixTimestamp: 0,
    acceptedForegroundFixes: 0,
    firstFreshFixAccepted: false,
    lastReliableSpeedKmh: 0,
    hardSnapConsumed: false,
    lastResumeRoadLockAt: 0,
    generation: 0,
    lastAcceptedSource: null,
    lastAcceptedSourceAt: 0,
    lastExpoSeenAt: 0,
    lastExpoAcceptedAt: 0,
    lastNativeSeenAt: 0,
    lastNativeAcceptedAt: 0,
  };
}

export function beginResumeRecovery(
  state: ResumeRecoveryState,
  input: {
    now: number;
    bgPauseMs: number;
    seedFixTimestamp?: number;
    lastReliableSpeedKmh?: number;
  },
): void {
  state.active = true;
  state.phase = 'restoringFromNative';
  state.startedAt = input.now;
  state.bgPauseMs = Math.max(0, input.bgPauseMs);
  state.seedFixTimestamp = input.seedFixTimestamp ?? 0;
  state.acceptedForegroundFixes = 0;
  state.firstFreshFixAccepted = false;
  state.lastReliableSpeedKmh = Math.max(0, input.lastReliableSpeedKmh ?? state.lastReliableSpeedKmh);
  state.hardSnapConsumed = false;
  state.lastResumeRoadLockAt = 0;
  state.generation += 1;
  state.lastAcceptedSource = null;
  state.lastAcceptedSourceAt = 0;
  state.lastExpoSeenAt = 0;
  state.lastExpoAcceptedAt = 0;
  state.lastNativeSeenAt = 0;
  state.lastNativeAcceptedAt = 0;
}

export function maybeFinishResumeRecovery(
  state: ResumeRecoveryState,
  now: number,
  minAcceptedFixes = 3,
  maxAgeMs = 9000,
): void {
  if (!state.active) return;
  if (state.acceptedForegroundFixes >= minAcceptedFixes || now - state.startedAt >= maxAgeMs) {
    state.active = false;
    state.phase = 'live';
  }
}

export function classifyFixFreshness(
  fix: ResumeFixLike,
  now = Date.now(),
  input?: {
    freshMaxAgeMs?: number;
    seedMaxAgeMs?: number;
  },
): ResumeFixFreshness {
  const timestamp = finiteNumber(fix.timestamp) ?? finiteNumber(fix.receivedAt) ?? 0;
  const ageMs = timestamp > 0 ? Math.max(0, now - timestamp) : Number.POSITIVE_INFINITY;
  const freshMaxAgeMs = input?.freshMaxAgeMs ?? RESUME_UI_FRESH_FIX_MAX_AGE_MS;
  const seedMaxAgeMs = input?.seedMaxAgeMs ?? RESUME_UI_SEED_FIX_MAX_AGE_MS;
  const source = typeof fix.source === 'string' ? fix.source : null;
  const isSeed = fix.isSeed === true || source === 'lastKnown';

  if (!isSeed && ageMs <= freshMaxAgeMs) return 'fresh';
  if (ageMs <= seedMaxAgeMs) return 'seed';
  return 'stale';
}

export function canBypassGpsLockDuringResume(
  fix: ResumeFixLike,
  state: ResumeRecoveryState,
  input?: {
    now?: number;
    maxAccuracyM?: number;
  },
): boolean {
  if (!state.active) return false;
  const now = input?.now ?? Date.now();
  const lat = finiteNumber(fix.latitude);
  const lng = finiteNumber(fix.longitude);
  if (lat == null || lng == null) return false;
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return false;
  const acc = finiteNumber(fix.accuracy);
  if (acc != null && acc > (input?.maxAccuracyM ?? DEFAULT_RESUME_MAX_ACCURACY_M)) return false;
  return classifyFixFreshness(fix, now) === 'fresh';
}

export function markResumeSourceSeen(
  state: ResumeRecoveryState,
  source: ResumeRecoverySource,
  now = Date.now(),
): void {
  if (source === 'expo') state.lastExpoSeenAt = now;
  if (source === 'native') state.lastNativeSeenAt = now;
}

export function markResumeSourceAccepted(
  state: ResumeRecoveryState,
  source: ResumeRecoverySource,
  now = Date.now(),
): void {
  state.lastAcceptedSource = source;
  state.lastAcceptedSourceAt = now;
  if (source === 'expo') state.lastExpoAcceptedAt = now;
  if (source === 'native') state.lastNativeAcceptedAt = now;
}

export function shouldAcceptResumeSource(
  state: ResumeRecoveryState,
  source: ResumeRecoverySource,
  now: number,
  input?: {
    expoFreshMs?: number;
    nativeFreshMs?: number;
    duplicateWindowMs?: number;
  },
): boolean {
  const duplicateWindowMs = input?.duplicateWindowMs ?? 900;
  if (
    state.lastAcceptedSource
    && state.lastAcceptedSource !== source
    && now - state.lastAcceptedSourceAt < duplicateWindowMs
  ) {
    if (source === 'native' && input?.expoFreshMs != null && input.expoFreshMs < 1500) return false;
    if (source === 'expo' && input?.nativeFreshMs != null && input.nativeFreshMs < 450) return false;
  }
  return true;
}

export function resolveResumeSpeedKmh(
  fix: ResumeFixLike,
  previousFix: ResumeFixLike | PreviousRawFixLike | null,
  state: ResumeRecoveryState,
  input?: {
    now?: number;
    maxSpeedKmh?: number;
    nativeSpeedMaxKmh?: number;
    riseCapKmh?: number;
    dtMinMs?: number;
    dtMaxMs?: number;
    previousReliableKmh?: number;
  },
): ResumeSpeedResolution {
  const now = input?.now ?? Date.now();
  const maxSpeedKmh = input?.maxSpeedKmh ?? DEFAULT_MAX_SPEED_KMH;
  const nativeSpeedMaxKmh = input?.nativeSpeedMaxKmh ?? DEFAULT_NATIVE_SPEED_MAX_KMH;
  const riseCapKmh = input?.riseCapKmh ?? DEFAULT_RESUME_SPEED_RISE_CAP_KMH;
  const dtMinMs = input?.dtMinMs ?? DEFAULT_RESUME_DT_MIN_MS;
  const dtMaxMs = input?.dtMaxMs ?? DEFAULT_RESUME_DT_MAX_MS;
  const previousReliableKmh = Math.max(
    0,
    input?.previousReliableKmh ?? state.lastReliableSpeedKmh,
  );
  const rawSpeedMs = finiteNumber(fix.speed);
  let candidateKmh = 0;
  let source: ResumeSpeedResolution['source'] = 'none';
  let reliable = false;

  if (rawSpeedMs != null && rawSpeedMs >= 0.3) {
    const nativeKmh = rawSpeedMs * 3.6;
    if (nativeKmh <= nativeSpeedMaxKmh) {
      candidateKmh = nativeKmh;
      source = 'native';
      reliable = true;
    }
  }

  if (!reliable && previousFix) {
    const prevLat = 'lat' in previousFix ? finiteNumber(previousFix.lat) : finiteNumber(previousFix.latitude);
    const prevLng = 'lng' in previousFix ? finiteNumber(previousFix.lng) : finiteNumber(previousFix.longitude);
    const prevTs = 'at' in previousFix ? finiteNumber(previousFix.at) : finiteNumber(previousFix.timestamp);
    const fixTs = finiteNumber(fix.timestamp) ?? now;
    const lat = finiteNumber(fix.latitude);
    const lng = finiteNumber(fix.longitude);
    const dtMs = prevTs != null ? fixTs - prevTs : 0;
    if (
      lat != null
      && lng != null
      && prevLat != null
      && prevLng != null
      && dtMs >= dtMinMs
      && dtMs <= dtMaxMs
    ) {
      const movedM = haversineM(prevLat, prevLng, lat, lng);
      if (movedM >= 2.5) {
        candidateKmh = (movedM / (dtMs / 1000)) * 3.6;
        source = 'derived';
        reliable = candidateKmh <= maxSpeedKmh;
      }
    }
  }

  if (!reliable) {
    candidateKmh = previousReliableKmh;
    source = previousReliableKmh > 0 ? 'held' : 'none';
  }

  const maxAllowedKmh = previousReliableKmh > 0
    ? Math.min(maxSpeedKmh, previousReliableKmh + riseCapKmh)
    : maxSpeedKmh;
  const capped = reliable && candidateKmh > maxAllowedKmh;
  const speedKmh = Math.max(0, Math.min(maxSpeedKmh, capped ? maxAllowedKmh : candidateKmh));
  if (reliable && !capped) {
    state.lastReliableSpeedKmh = speedKmh;
  }
  state.seedFixTimestamp = finiteNumber(fix.timestamp) ?? state.seedFixTimestamp;
  return {
    speedKmh,
    speedMs: speedKmh > 0 ? speedKmh / 3.6 : null,
    reliable: reliable && !capped,
    source: capped ? 'held' : source,
    capped,
  };
}

export function quarantineHudSpeedKmh(
  state: ResumeRecoveryState,
  candidateKmh: number,
  input?: {
    now?: number;
    riseCapKmh?: number;
    maxSpeedKmh?: number;
  },
): number {
  const now = input?.now ?? Date.now();
  const maxSpeedKmh = input?.maxSpeedKmh ?? DEFAULT_MAX_SPEED_KMH;
  const riseCapKmh = input?.riseCapKmh ?? DEFAULT_RESUME_SPEED_RISE_CAP_KMH;
  const safeCandidate = Math.max(0, Math.min(maxSpeedKmh, Number.isFinite(candidateKmh) ? candidateKmh : 0));
  if (!state.active) {
    state.lastReliableSpeedKmh = safeCandidate;
    return safeCandidate;
  }
  const baseline = Math.max(0, state.lastReliableSpeedKmh);
  const cap = baseline > 0 ? Math.min(maxSpeedKmh, baseline + riseCapKmh) : maxSpeedKmh;
  const accepted = safeCandidate > cap ? baseline : safeCandidate;
  state.acceptedForegroundFixes += 1;
  if (accepted > 0 && safeCandidate <= cap) {
    state.lastReliableSpeedKmh = accepted;
    state.firstFreshFixAccepted = true;
  }
  maybeFinishResumeRecovery(state, now);
  return accepted;
}
