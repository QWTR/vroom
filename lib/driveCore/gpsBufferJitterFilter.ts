import { distanceM } from './geo';
import type { BufferedGpsPoint, RawGpsFix } from './types';

/** Ignore GPS micro-jitter below this distance (pre-buffer). */
export const GPS_BUFFER_JITTER_MIN_M = 5;
/** Drop fixes implying impossible vehicle speed (GPS spike). */
export const GPS_BUFFER_MAX_IMPLausible_SPEED_KMH = 250;

export type JitterFilterMetrics = {
  accepted: number;
  rejectedDistance: number;
  rejectedSpeed: number;
};

/**
 * Pre-buffer validation: dedupe stationary jitter and reject teleport spikes.
 * Does NOT affect raw GPS fed to the marker — only the Map Matching buffer.
 */
export class GpsBufferJitterFilter {
  private lastAccepted: BufferedGpsPoint | null = null;

  private lastAcceptedWallMs = 0;

  private metrics: JitterFilterMetrics = {
    accepted: 0,
    rejectedDistance: 0,
    rejectedSpeed: 0,
  };

  reset(): void {
    this.lastAccepted = null;
    this.lastAcceptedWallMs = 0;
    this.metrics = { accepted: 0, rejectedDistance: 0, rejectedSpeed: 0 };
  }

  getMetrics(): JitterFilterMetrics {
    return { ...this.metrics };
  }

  accept(raw: RawGpsFix): boolean {
    const candidate: BufferedGpsPoint = {
      lat: raw.lat,
      lng: raw.lng,
      timestamp: raw.timestamp,
    };

    if (!this.lastAccepted) {
      this.commit(candidate);
      return true;
    }

    const distM = distanceM(
      this.lastAccepted.lat,
      this.lastAccepted.lng,
      candidate.lat,
      candidate.lng,
    );

    if (distM < GPS_BUFFER_JITTER_MIN_M) {
      this.metrics.rejectedDistance += 1;
      return false;
    }

    const now = Date.now();
    const dtMs = Math.max(
      50,
      candidate.timestamp > this.lastAccepted.timestamp
        ? candidate.timestamp - this.lastAccepted.timestamp
        : now - this.lastAcceptedWallMs,
    );
    const impliedSpeedKmh = (distM / (dtMs / 1000)) * 3.6;
    if (impliedSpeedKmh > GPS_BUFFER_MAX_IMPLausible_SPEED_KMH) {
      this.metrics.rejectedSpeed += 1;
      return false;
    }

    this.commit(candidate);
    return true;
  }

  private commit(point: BufferedGpsPoint): void {
    this.lastAccepted = point;
    this.lastAcceptedWallMs = Date.now();
    this.metrics.accepted += 1;
  }
}
