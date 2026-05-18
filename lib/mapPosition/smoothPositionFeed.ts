export type SmoothTarget = {
  latitude: number;
  longitude: number;
  heading: number;
  /** Expected time until next GPS fix (ms). */
  durationMs?: number;
};

type FeedHandler = (target: SmoothTarget) => void;

let handler: FeedHandler | null = null;
/** Ostatni target — odtwarzany po montażu SmoothDrPositionMarker (wejście w jazdę woła feed przed re-renderem). */
let lastTarget: SmoothTarget | null = null;

export function registerSmoothPositionHandler(fn: FeedHandler | null): void {
  handler = fn;
  if (fn && lastTarget) {
    fn(lastTarget);
  }
}

export function feedSmoothPositionTarget(target: SmoothTarget): void {
  if (
    !Number.isFinite(target.latitude) ||
    !Number.isFinite(target.longitude) ||
    !Number.isFinite(target.heading)
  ) {
    return;
  }
  lastTarget = target;
  handler?.(target);
}
