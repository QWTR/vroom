import { useSyncExternalStore } from 'react';

export type MapPose = {
  lat: number;
  lng: number;
  heading: number;
  ts: number;
};

let pose: MapPose = { lat: 0, lng: 0, heading: 0, ts: 0 };
const listeners = new Set<() => void>();

export function subscribeMapPose(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMapPose(): MapPose {
  return pose;
}

export function setMapPose(next: Partial<MapPose>): void {
  const lat = next.lat ?? pose.lat;
  const lng = next.lng ?? pose.lng;
  const heading = next.heading ?? pose.heading;
  if (
    lat === pose.lat &&
    lng === pose.lng &&
    heading === pose.heading
  ) {
    return;
  }
  pose = { lat, lng, heading, ts: Date.now() };
  listeners.forEach((l) => l());
}

export function useMapPoseSnapshot(): MapPose {
  return useSyncExternalStore(subscribeMapPose, getMapPose, getMapPose);
}
