import { fromLocalEnuM, headingDeltaDeg, toLocalEnuM } from './geoMath';

/**
 * 2D constant-velocity Kalman filter in a local ENU tangent plane.
 * State: [east, north, vEast, vNorth] in meters / m/s.
 */
export class VehicleKalmanFilter {
  private anchorLat: number | null = null;
  private anchorLng: number | null = null;
  /** [e, n, ve, vn] */
  private x: number[] | null = null;
  /** 4×4 covariance (row-major flat) */
  private P: number[] | null = null;
  private lastTimeMs: number | null = null;

  private processPosVar = 0.35;
  private processVelVar = 1.2;
  private measPosBaseVar = 4;
  private lastGpsHeadingDeg: number | null = null;
  private lastGpsHeadingAtMs: number | null = null;
  private readonly MANEUVER_HEADING_DELTA_DEG = 15;
  private readonly MANEUVER_WINDOW_MS = 2500;
  private readonly MANEUVER_Q_POS = 2.5;
  private readonly MANEUVER_Q_VEL = 3.2;

  reset(): void {
    this.anchorLat = null;
    this.anchorLng = null;
    this.x = null;
    this.P = null;
    this.lastTimeMs = null;
    this.lastGpsHeadingDeg = null;
    this.lastGpsHeadingAtMs = null;
  }

  setProcessNoise(posVar: number, velVar: number): void {
    this.processPosVar = Math.max(0.05, posVar);
    this.processVelVar = Math.max(0.1, velVar);
  }

  /**
   * @param accuracyM Horizontal GPS accuracy (m). Higher → more measurement noise.
   */
  filter(
    lat: number,
    lng: number,
    accuracyM: number,
    timestampMs: number,
    speedKmh = 0,
    gpsHeadingDeg?: number | null,
  ): { latitude: number; longitude: number; velocityMs: number; headingDeg: number } {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng, velocityMs: 0, headingDeg: 0 };
    }

    const acc = Math.max(3, Math.min(accuracyM || 25, 120));
    const measVar = this.measPosBaseVar + (acc * acc) * 0.55;

    if (this.x == null || this.anchorLat == null || this.anchorLng == null) {
      this.anchorLat = lat;
      this.anchorLng = lng;
      const enu = toLocalEnuM(lat, lng, lat, lng);
      this.x = [enu.east, enu.north, 0, 0];
      this.P = identityP(4, 8);
      this.lastTimeMs = timestampMs;
      return { latitude: lat, longitude: lng, velocityMs: 0, headingDeg: 0 };
    }

    const dtSec = this.lastTimeMs != null
      ? Math.max(0.05, Math.min(3.5, (timestampMs - this.lastTimeMs) / 1000))
      : 1;
    this.lastTimeMs = timestampMs;

    const speedFactor = Math.min(1, Math.max(0, (speedKmh - 15) / 75));
    let qPos = this.processPosVar * (1 + speedFactor * 2.2);
    let qVel = this.processVelVar * (1 + speedFactor * 3.5);

    const [, , preVe, preVn] = this.x!;
    const preVelocityMs = Math.sqrt(preVe * preVe + preVn * preVn);
    const predictedHeadingDeg = preVelocityMs > 0.4
      ? ((Math.atan2(preVe, preVn) * 180) / Math.PI + 360) % 360
      : (this.lastGpsHeadingDeg ?? 0);

    let maneuver = false;
    if (gpsHeadingDeg != null && Number.isFinite(gpsHeadingDeg) && preVelocityMs > 0.35) {
      const vsPredicted = headingDeltaDeg(gpsHeadingDeg, predictedHeadingDeg);
      const vsLast = this.lastGpsHeadingDeg != null
        ? headingDeltaDeg(gpsHeadingDeg, this.lastGpsHeadingDeg)
        : 0;
      const dtHeadingMs = this.lastGpsHeadingAtMs != null
        ? timestampMs - this.lastGpsHeadingAtMs
        : 9999;
      maneuver = vsPredicted >= this.MANEUVER_HEADING_DELTA_DEG
        || (dtHeadingMs <= this.MANEUVER_WINDOW_MS && vsLast >= this.MANEUVER_HEADING_DELTA_DEG);
      this.lastGpsHeadingDeg = gpsHeadingDeg;
      this.lastGpsHeadingAtMs = timestampMs;
    }

    if (maneuver) {
      qPos = Math.max(qPos, this.MANEUVER_Q_POS);
      qVel = Math.max(qVel, this.MANEUVER_Q_VEL);
    }

    predictCv(this.x, this.P!, dtSec, qPos, qVel);

    const enu = toLocalEnuM(this.anchorLat, this.anchorLng, lat, lng);
    updatePosition(this.x, this.P!, enu.east, enu.north, measVar);

    const [e, n, ve, vn] = this.x;
    const filtered = fromLocalEnuM(this.anchorLat, this.anchorLng, e, n);
    const velocityMs = Math.sqrt(ve * ve + vn * vn);
    const headingDeg = velocityMs > 0.4
      ? ((Math.atan2(ve, vn) * 180) / Math.PI + 360) % 360
      : 0;

    if (haversineAnchorDriftM(this.anchorLat, this.anchorLng, filtered.latitude, filtered.longitude) > 800) {
      this.anchorLat = filtered.latitude;
      this.anchorLng = filtered.longitude;
      const reEnu = toLocalEnuM(this.anchorLat, this.anchorLng, filtered.latitude, filtered.longitude);
      this.x[0] = reEnu.east;
      this.x[1] = reEnu.north;
    }

    return {
      latitude: filtered.latitude,
      longitude: filtered.longitude,
      velocityMs,
      headingDeg,
    };
  }

  /** Dead reckoning between GPS fixes. */
  predictForward(timestampMs: number): { latitude: number; longitude: number } | null {
    if (this.x == null || this.anchorLat == null || this.anchorLng == null || this.lastTimeMs == null) {
      return null;
    }
    const dtSec = Math.max(0, Math.min(2, (timestampMs - this.lastTimeMs) / 1000));
    if (dtSec < 0.02) return null;
    const [e, n, ve, vn] = this.x;
    const pred = fromLocalEnuM(this.anchorLat, this.anchorLng, e + ve * dtSec, n + vn * dtSec);
    return pred;
  }
}

function haversineAnchorDriftM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function identityP(n: number, scale: number): number[] {
  const p = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) p[i * n + i] = scale;
  return p;
}

function predictCv(x: number[], P: number[], dt: number, qPos: number, qVel: number): void {
  const F = [
    1, 0, dt, 0,
    0, 1, 0, dt,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const xNew = matVec4(F, x);
  x[0] = xNew[0]; x[1] = xNew[1]; x[2] = xNew[2]; x[3] = xNew[3];
  const Pn = matMul4(F, matMul4(P, transpose4(F)));
  Pn[0] += qPos; Pn[5] += qPos; Pn[10] += qVel; Pn[15] += qVel;
  for (let i = 0; i < 16; i++) P[i] = Pn[i];
}

function updatePosition(x: number[], P: number[], measE: number, measN: number, rVar: number): void {
  const z = [measE, measN];
  const H = [
    1, 0, 0, 0,
    0, 1, 0, 0,
  ];
  const Hx = [x[0], x[1]];
  const y = [z[0] - Hx[0], z[1] - Hx[1]];
  const S = [
    P[0] + rVar, P[1],
    P[4], P[5] + rVar,
  ];
  const det = S[0] * S[3] - S[1] * S[2];
  if (Math.abs(det) < 1e-9) return;
  const Sinv = [S[3] / det, -S[1] / det, -S[2] / det, S[0] / det];
  const K = [
    (P[0] * Sinv[0] + P[1] * Sinv[2]), (P[0] * Sinv[1] + P[1] * Sinv[3]),
    (P[4] * Sinv[0] + P[5] * Sinv[2]), (P[4] * Sinv[1] + P[5] * Sinv[3]),
    (P[8] * Sinv[0] + P[9] * Sinv[2]), (P[8] * Sinv[1] + P[9] * Sinv[3]),
    (P[12] * Sinv[0] + P[13] * Sinv[2]), (P[12] * Sinv[1] + P[13] * Sinv[3]),
  ];
  x[0] += K[0] * y[0] + K[1] * y[1];
  x[1] += K[2] * y[0] + K[3] * y[1];
  x[2] += K[4] * y[0] + K[5] * y[1];
  x[3] += K[6] * y[0] + K[7] * y[1];
  const IKH = [
    1 - K[0], -K[1], -K[2], -K[3],
    -K[4], 1 - K[5], -K[6], -K[7],
    -K[8], -K[9], 1, 0,
    -K[10], -K[11], 0, 1,
  ];
  const Pn = matMul4(IKH, P);
  for (let i = 0; i < 16; i++) P[i] = Pn[i];
}

function matVec4(m: number[], v: number[]): number[] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3],
    m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3],
  ];
}

function matMul4(a: number[], b: number[]): number[] {
  const r = new Array(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[row * 4 + k] * b[k * 4 + col];
      r[row * 4 + col] = s;
    }
  }
  return r;
}

function transpose4(m: number[]): number[] {
  return [
    m[0], m[4], m[8], m[12],
    m[1], m[5], m[9], m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15],
  ];
}
