export type LiveTripPose = {
  latitude: number;
  longitude: number;
  headingDeg: number;
};

export type LiveTripPoseInput = {
  drLat: number;
  drLng: number;
  drHdg: number;
  /** When true, trust drLat/drLng as SSOT (active driving/navigation). */
  tripActive: boolean;
  lastSetLoc?: { lat: number; lng: number } | null;
  lastGoodLoc?: { lat: number; lng: number } | null;
};

function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);
}

/**
 * Live vehicle pose for routing / bootstrap — prefers drLatRef/drLngRef during trip.
 */
export function getLiveTripPose(input: LiveTripPoseInput): LiveTripPose | null {
  const { drLat, drLng, drHdg, tripActive, lastSetLoc, lastGoodLoc } = input;
  const headingDeg = Number.isFinite(drHdg) ? drHdg : 0;

  if (tripActive && isValidCoord(drLat, drLng)) {
    return { latitude: drLat, longitude: drLng, headingDeg };
  }

  if (isValidCoord(drLat, drLng)) {
    return { latitude: drLat, longitude: drLng, headingDeg };
  }

  if (lastSetLoc && isValidCoord(lastSetLoc.lat, lastSetLoc.lng)) {
    return { latitude: lastSetLoc.lat, longitude: lastSetLoc.lng, headingDeg };
  }

  if (lastGoodLoc && isValidCoord(lastGoodLoc.lat, lastGoodLoc.lng)) {
    return { latitude: lastGoodLoc.lat, longitude: lastGoodLoc.lng, headingDeg };
  }

  return null;
}
