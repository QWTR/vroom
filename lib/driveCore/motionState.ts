import { MOTION_MAX_ACCURACY_M, MOTION_MIN_DIST_M, MOTION_STOP_CLUSTER_M, MOTION_STOP_CONSECUTIVE } from './config';
import { distanceM } from './geo';
import type { RawGpsFix } from './types';

export type MotionStateSnapshot = {
  isMoving: boolean;
  stopAnchor: { lat: number; lng: number };
};

export class MotionStateMachine {
  private stopAnchor = { lat: 0, lng: 0 };
  private isMoving = false;
  private stopCluster: RawGpsFix[] = [];
  private initialized = false;

  reset(anchor?: { lat: number; lng: number }): void {
    this.isMoving = false;
    this.stopCluster = [];
    if (anchor) {
      this.stopAnchor = { ...anchor };
      this.initialized = true;
    } else {
      this.initialized = false;
    }
  }

  getSnapshot(): MotionStateSnapshot {
    return { isMoving: this.isMoving, stopAnchor: { ...this.stopAnchor } };
  }

  update(raw: RawGpsFix): boolean {
    if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return this.isMoving;
    if (!this.initialized) {
      this.stopAnchor = { lat: raw.lat, lng: raw.lng };
      this.initialized = true;
      return false;
    }
    if (raw.accuracy > MOTION_MAX_ACCURACY_M) {
      return this.isMoving;
    }

    if (!this.isMoving) {
      const d = distanceM(raw.lat, raw.lng, this.stopAnchor.lat, this.stopAnchor.lng);
      if (d >= MOTION_MIN_DIST_M) {
        this.isMoving = true;
        this.stopCluster = [];
      }
      return this.isMoving;
    }

    // Moving → check stop cluster
    if (this.stopCluster.length === 0) {
      this.stopCluster.push(raw);
    } else {
      const center = clusterCenter(this.stopCluster);
      const dFromCenter = distanceM(raw.lat, raw.lng, center.lat, center.lng);
      if (dFromCenter <= MOTION_STOP_CLUSTER_M) {
        this.stopCluster.push(raw);
        if (this.stopCluster.length > MOTION_STOP_CONSECUTIVE + 2) {
          this.stopCluster.shift();
        }
      } else {
        this.stopCluster = [raw];
      }
    }

    if (this.stopCluster.length >= MOTION_STOP_CONSECUTIVE) {
      const c = clusterCenter(this.stopCluster);
      this.stopAnchor = { lat: c.lat, lng: c.lng };
      this.isMoving = false;
      this.stopCluster = [];
    }
    return this.isMoving;
  }
}

function clusterCenter(points: RawGpsFix[]): { lat: number; lng: number } {
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  const n = points.length || 1;
  return { lat: lat / n, lng: lng / n };
}
