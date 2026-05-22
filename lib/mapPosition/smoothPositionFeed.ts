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

let handler: FeedHandler | null = null;
/** Ostatni target — odtwarzany po montażu SmoothDrPositionMarker (wejście w jazdę woła feed przed re-renderem). */
let lastTarget: SmoothTarget | null = null;

export function registerSmoothPositionHandler(fn: FeedHandler | null): void {
  handler = fn;
  if (fn && lastTarget) {
    vroomGpsLog('WORKLET_HANDLER_REGISTERED', {
      hasLastTarget: !!lastTarget,
    }, 0);
    fn(lastTarget);
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
}
