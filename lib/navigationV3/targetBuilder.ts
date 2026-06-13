import { NAV_V3 } from './config';
import type { ArcWindowSlice, NavigationTarget, SnapResult } from './types';
import { bearingBetween, alignBearingToReference } from '../../scripts/navigationUtils';

function pointAtArcWindow(
  window: ArcWindowSlice,
  localArcM: number,
): { lat: number; lng: number } | null {
  const cum = window.cumM;
  const pts = window.points;
  if (pts.length < 2 || cum.length < 2) return null;

  const total = cum[cum.length - 1];
  const clamped = Math.max(0, Math.min(total, localArcM));
  let seg = 0;
  for (let i = 0; i < cum.length - 1; i += 1) {
    if (clamped <= cum[i + 1]) {
      seg = i;
      break;
    }
    seg = i;
  }

  const a = pts[seg];
  const b = pts[seg + 1];
  if (!a || !b) return null;
  const segLen = Math.max(0.001, cum[seg + 1] - cum[seg]);
  const t = (clamped - cum[seg]) / segLen;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

/** Look-ahead bearing: snap → punkt 15–20 m przed na polilinii (nie segment pod maską). */
function bearingLookAheadFromSnap(snap: SnapResult): number | null {
  if (!snap.arcWindow || snap.arcM == null || !Number.isFinite(snap.arcM)) {
    return null;
  }

  const localM = snap.arcM - snap.arcWindow.baseArcM;
  const total = snap.arcWindow.cumM[snap.arcWindow.cumM.length - 1];
  if (!Number.isFinite(total) || total < 0.001) return null;

  const lookaheadM = NAV_V3.SNAP_HEADING_LOOKAHEAD_M;
  const aheadM = Math.min(total, localM + lookaheadM);
  const curPt = pointAtArcWindow(snap.arcWindow, localM);
  const aheadPt = pointAtArcWindow(snap.arcWindow, aheadM);
  if (!curPt || !aheadPt) return null;

  const spanM = aheadM - localM;
  const fromLat = Number.isFinite(snap.lat) ? snap.lat : curPt.lat;
  const fromLng = Number.isFinite(snap.lng) ? snap.lng : curPt.lng;

  if (spanM < 4) {
    return alignBearingToReference(
      bearingBetween(fromLat, fromLng, aheadPt.lat, aheadPt.lng),
      snap.headingDeg,
    );
  }
  return alignBearingToReference(
    bearingBetween(curPt.lat, curPt.lng, aheadPt.lat, aheadPt.lng),
    snap.headingDeg,
  );
}

/** Heading markera — przy snapu look-ahead z geometrii drogi, nie surowy COG GPS. */
export function resolveSnapHeadingForTarget(snap: SnapResult): number {
  if (snap.roadBlend <= NAV_V3.ON_ROAD_BLEND_EPS) {
    return snap.headingDeg;
  }

  const lookAhead = bearingLookAheadFromSnap(snap);
  if (lookAhead != null && Number.isFinite(lookAhead)) {
    return lookAhead;
  }

  return snap.headingDeg;
}

export function buildNavigationTarget(
  snap: SnapResult,
  speedMs: number,
  allowInstant: boolean,
  gpsIntervalMs?: number,
): NavigationTarget {
  const intervalMs = Number.isFinite(gpsIntervalMs) && gpsIntervalMs! > 0
    ? gpsIntervalMs!
    : undefined;
  return {
    lat: snap.lat,
    lng: snap.lng,
    headingDeg: resolveSnapHeadingForTarget(snap),
    speedMs: Math.max(0, speedMs),
    pathMode: snap.pathMode,
    roadBlend: snap.roadBlend,
    rawLat: snap.rawLat,
    rawLng: snap.rawLng,
    targetArcM: snap.arcM,
    arcWindow: snap.arcWindow,
    polylineKey: snap.polylineKey,
    allowInstant,
    gpsIntervalMs: intervalMs,
  };
}
