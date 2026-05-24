import { vroomGpsLog } from '../vroomGpsLog';

export type SmoothTarget = {
  latitude: number;
  longitude: number;
  heading: number;
  /** Expected time until next GPS fix (ms). */
  durationMs?: number;
  /** Speed in m/s — używane do ciągłej ekstrapolacji po dotarciu do targetu (true Dead Reckoning). */
  speedMs?: number;
  /** Diagnostyka — kto wpycha target do worklet ('dr_onframe' | 'bump_active' | 'bootstrap' | 'recovery' | ...). */
  source?: string;
};

type FeedHandler = (target: SmoothTarget) => void;
type DisplayListener = (lat: number, lng: number, hdg: number) => void;

let handler: FeedHandler | null = null;
const displayListeners = new Set<DisplayListener>();
let lastDisplayNotifyMs = 0;
const DISPLAY_NOTIFY_MIN_MS = 16;

/** UI→JS sync pozycji markera/kamery (bez odczytu shared .value z watku JS). */
export function subscribeSmoothPositionDisplay(fn: DisplayListener): () => void {
  displayListeners.add(fn);
  return () => {
    displayListeners.delete(fn);
  };
}

export function notifySmoothPositionDisplay(lat: number, lng: number, hdg: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const now = Date.now();
  if (now - lastDisplayNotifyMs < DISPLAY_NOTIFY_MIN_MS) return;
  lastDisplayNotifyMs = now;
  displayListeners.forEach((fn) => {
    try {
      fn(lat, lng, hdg);
    } catch {
      /* listener moze byc po unmount */
    }
  });
}
/** Ostatni target — odtwarzany po montażu SmoothDrPositionMarker (wejście w jazdę woła feed przed re-renderem). */
let lastTarget: SmoothTarget | null = null;

/** Po wyjściu z trybu jazdy/nawigacji — bez re-play starego targetu przy remoncie workletu. */
export function clearSmoothPositionFeed(): void {
  lastTarget = null;
}

export function registerSmoothPositionHandler(fn: FeedHandler | null): void {
  handler = fn;
  if (fn && lastTarget) {
    vroomGpsLog('WORKLET_HANDLER_REGISTERED', {
      hasLastTarget: !!lastTarget,
    }, 0);
    fn(lastTarget);
    notifySmoothPositionDisplay(
      lastTarget.latitude,
      lastTarget.longitude,
      lastTarget.heading,
    );
  } else if (!fn) {
    vroomGpsLog('WORKLET_HANDLER_UNREGISTERED', {}, 0);
  }
}

export function feedSmoothPositionTarget(target: SmoothTarget): void {
  if (
    !Number.isFinite(target.latitude) ||
    !Number.isFinite(target.longitude) ||
    !Number.isFinite(target.heading)
  ) {
    vroomGpsLog('WORKLET_FEED_INVALID', {
      lat: target.latitude,
      lng: target.longitude,
      hdg: target.heading,
      source: target.source ?? 'unknown',
    }, 0);
    return;
  }
  // Throttled log every ~2.5s — wystarczy do diagnostyki, nie zatyka JS thread.
  // (Wcześniejsze 500ms × 2 log/s × overhead listenera powodowało drobne lagi mapy.)
  vroomGpsLog('WORKLET_FEED', {
    source: target.source ?? 'unknown',
    lat: Number(target.latitude.toFixed(6)),
    lng: Number(target.longitude.toFixed(6)),
    hdg: Math.round(target.heading || 0),
    durationMs: target.durationMs ?? null,
    speedMs: target.speedMs != null ? Number(target.speedMs.toFixed(2)) : null,
    hasHandler: !!handler,
  }, 2500);
  lastTarget = target;
  handler?.(target);
  // Tylko gdy worklet trip jest aktywny — inaczej po wyjściu z jazdy kamera/markery
  // dostawały ~60fps notify i wracały w styl follow.
  if (handler) {
    notifySmoothPositionDisplay(target.latitude, target.longitude, target.heading);
  }
}
