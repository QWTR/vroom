import { distanceM } from './geo';
import type { RawGpsFix } from './types';

/** Werdykt bramy jakości fixa GPS (warstwa B — kontekst jazdy). */
export type GpsQualityVerdict = 'FULL_ACCEPT' | 'DEGRADED' | 'REJECT';

export type GpsQualityResult = {
  verdict: GpsQualityVerdict;
  allowPositionUpdate: boolean;
  allowSpeedDelta: boolean;
  allowDoppler: boolean;
  reason?: string;
};

export type GpsQualityContext = {
  isMoving: boolean;
  isNavigating: boolean;
  lastSpeedKmh: number;
  /** Wolna jazda bez polilinii — łagodniejsza koperta kinematyczna. */
  freeDriveNoRoute?: boolean;
};

/** Start ruchu — wymagana dokładność. */
export const GATE_ACC_START_M = 20;
/** Pełna integracja (snap, prędkość, koperta). */
export const GATE_ACC_FULL_M = 30;
/** Degradacja: bez delty prędkości / aktualizacji pozycji. */
export const GATE_ACC_DEGRADED_MAX_M = 50;
/** Postój — FULL_ACCEPT do tego progu (gęsta zabudowa). */
export const GATE_ACC_STOP_UPDATE_M = 35;

const KIN_HARD_MIN_M = 35;
const KIN_SOFT_MIN_M = 22;
/** Free-drive bez cache trasy — słabszy GPS na drogach krajowych. */
const KIN_HARD_MIN_FREE_DRIVE_M = 60;
const KIN_SOFT_MIN_FREE_DRIVE_M = 38;
const KIN_HARD_FACTOR = 2.2;
const KIN_SOFT_FACTOR = 1.6;
const BAD_VERDICT_RESET_STREAK = 3;
const KIN_MAX_SPEED_KMH = 130;
const KIN_SPEED_MARGIN_KMH = 40;
const KIN_MAX_DT_SEC = 2;
const DOPPLER_MAX_JUMP_KMH = 35;
/** Wake Doppler — 2 kolejne fixy >= tej prędkości (także przy DEGRADED). */
export const GPS_WAKE_MIN_KMH = 5;
const GPS_WAKE_CONSECUTIVE = 2;

type AcceptedFix = {
  lat: number;
  lng: number;
  timestamp: number;
  accuracy: number;
};

/**
 * Bramka jakości fixów w DriveEngine — koperta kinematyczna + progi accuracy.
 */
export class GpsQualityGate {
  private lastAccepted: AcceptedFix | null = null;
  private wakeStreak = 0;
  private badVerdictStreak = 0;

  reset(): void {
    this.lastAccepted = null;
    this.wakeStreak = 0;
    this.badVerdictStreak = 0;
  }

  /**
   * 3× z rzędu DEGRADED/REJECT przy isMoving → pełny reset + seed (caller: commitAccepted).
   */
  registerBadVerdict(verdict: GpsQualityVerdict, isMoving: boolean): boolean {
    if (!isMoving || verdict === 'FULL_ACCEPT') {
      this.badVerdictStreak = 0;
      return false;
    }
    if (verdict === 'DEGRADED' || verdict === 'REJECT') {
      this.badVerdictStreak += 1;
    } else {
      this.badVerdictStreak = 0;
    }
    if (this.badVerdictStreak < BAD_VERDICT_RESET_STREAK) {
      return false;
    }
    this.badVerdictStreak = 0;
    this.reset();
    return true;
  }

  resetBadVerdictStreak(): void {
    this.badVerdictStreak = 0;
  }

  /** Aktualizuje punkt odniesienia koperty kinematycznej. */
  commitAccepted(raw: RawGpsFix): void {
    this.lastAccepted = {
      lat: raw.lat,
      lng: raw.lng,
      timestamp: raw.timestamp,
      accuracy: raw.accuracy,
    };
  }

  /**
   * Budzenie postoju z Dopplera — 2 fixy >= GPS_WAKE_MIN_KMH.
   * Działa przy FULL_ACCEPT i DEGRADED (nie przy REJECT).
   */
  registerWakeSample(raw: RawGpsFix, verdict: GpsQualityVerdict): boolean {
    const gpsKmh =
      raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0
        ? raw.gpsSpeedMs * 3.6
        : 0;
    if (
      verdict !== 'REJECT'
      && gpsKmh >= GPS_WAKE_MIN_KMH
      && gpsKmh <= KIN_MAX_SPEED_KMH
    ) {
      this.wakeStreak += 1;
    } else {
      this.wakeStreak = 0;
    }
    return this.wakeStreak >= GPS_WAKE_CONSECUTIVE;
  }

  resetWakeStreak(): void {
    this.wakeStreak = 0;
  }

  evaluate(raw: RawGpsFix, ctx: GpsQualityContext): GpsQualityResult {
    const acc = Number.isFinite(raw.accuracy) ? raw.accuracy : 999;

    if (acc > GATE_ACC_DEGRADED_MAX_M) {
      return reject('accuracy_hard');
    }

    const accVerdict = this.evaluateAccuracy(acc, ctx.isMoving);
    if (accVerdict === 'REJECT') {
      return reject('accuracy');
    }

    const kin = this.evaluateKinematic(
      raw,
      ctx.lastSpeedKmh,
      !!ctx.freeDriveNoRoute,
    );
    if (kin === 'REJECT') {
      return reject('kinematic_hard');
    }

    const degraded = accVerdict === 'DEGRADED' || kin === 'DEGRADED';

    if (degraded) {
      return {
        verdict: 'DEGRADED',
        allowPositionUpdate: false,
        allowSpeedDelta: false,
        allowDoppler: this.allowDoppler(raw, ctx.lastSpeedKmh, false),
        reason: accVerdict === 'DEGRADED' ? 'accuracy_soft' : 'kinematic_soft',
      };
    }

    return {
      verdict: 'FULL_ACCEPT',
      allowPositionUpdate: true,
      allowSpeedDelta: true,
      allowDoppler: this.allowDoppler(raw, ctx.lastSpeedKmh, true),
    };
  }

  private evaluateAccuracy(
    acc: number,
    isMoving: boolean,
  ): GpsQualityVerdict | 'REJECT' {
    if (!isMoving) {
      if (acc > GATE_ACC_DEGRADED_MAX_M) return 'REJECT';
      if (acc > GATE_ACC_STOP_UPDATE_M) return 'DEGRADED';
      return 'FULL_ACCEPT';
    }

    if (acc <= GATE_ACC_FULL_M) return 'FULL_ACCEPT';
    if (acc <= GATE_ACC_DEGRADED_MAX_M) return 'DEGRADED';
    return 'REJECT';
  }

  private evaluateKinematic(
    raw: RawGpsFix,
    lastSpeedKmh: number,
    freeDriveNoRoute: boolean,
  ): GpsQualityVerdict {
    if (!this.lastAccepted) return 'FULL_ACCEPT';

    const dtSec = Math.max(
      0.05,
      (raw.timestamp - this.lastAccepted.timestamp) / 1000,
    );
    if (dtSec > KIN_MAX_DT_SEC) return 'FULL_ACCEPT';

    const distM = distanceM(
      this.lastAccepted.lat,
      this.lastAccepted.lng,
      raw.lat,
      raw.lng,
    );

    const vMaxKmh = this.kinematicSpeedCapKmh(raw, lastSpeedKmh);
    const vMaxMs = vMaxKmh / 3.6;

    const hardMin = freeDriveNoRoute ? KIN_HARD_MIN_FREE_DRIVE_M : KIN_HARD_MIN_M;
    const softMin = freeDriveNoRoute ? KIN_SOFT_MIN_FREE_DRIVE_M : KIN_SOFT_MIN_M;
    const hardM = Math.max(hardMin, vMaxMs * dtSec * KIN_HARD_FACTOR);
    const softM = Math.max(softMin, vMaxMs * dtSec * KIN_SOFT_FACTOR);

    if (distM > hardM) return 'REJECT';
    if (distM > softM) return 'DEGRADED';
    return 'FULL_ACCEPT';
  }

  private kinematicSpeedCapKmh(raw: RawGpsFix, lastSpeedKmh: number): number {
    let cap = Math.min(
      KIN_MAX_SPEED_KMH,
      Math.max(0, lastSpeedKmh) + KIN_SPEED_MARGIN_KMH,
    );
    const gpsKmh =
      raw.gpsSpeedMs != null && raw.gpsSpeedMs >= 0
        ? raw.gpsSpeedMs * 3.6
        : NaN;
    if (
      Number.isFinite(gpsKmh)
      && raw.accuracy <= GATE_ACC_FULL_M
      && gpsKmh <= KIN_MAX_SPEED_KMH
    ) {
      cap = Math.min(cap, gpsKmh + 15);
    }
    return Math.max(8, cap);
  }

  private allowDoppler(
    raw: RawGpsFix,
    lastSpeedKmh: number,
    fullAccept: boolean,
  ): boolean {
    if (!fullAccept) return false;
    if (raw.accuracy > GATE_ACC_FULL_M) return false;
    const gpsMs = raw.gpsSpeedMs;
    if (gpsMs == null || !Number.isFinite(gpsMs) || gpsMs < 0) return false;
    const gpsKmh = gpsMs * 3.6;
    if (gpsKmh > KIN_MAX_SPEED_KMH) return false;
    if (lastSpeedKmh > 0.5 && Math.abs(gpsKmh - lastSpeedKmh) > DOPPLER_MAX_JUMP_KMH) {
      return false;
    }
    return true;
  }
}

function reject(reason: string): GpsQualityResult {
  return {
    verdict: 'REJECT',
    allowPositionUpdate: false,
    allowSpeedDelta: false,
    allowDoppler: false,
    reason,
  };
}

/** Warstwa A — progi współdzielone z useAdaptiveGPS. */
export const GPS_LAYER_A_ACTIVE_REJECT_ACC_M = 20;
export const GPS_LAYER_A_ACTIVE_TELEPORT_M = 80;
export const GPS_LAYER_A_ACTIVE_TELEPORT_MAX_DT_MS = 1500;

export function isActiveLayerATeleport(distM: number, dtMs: number): boolean {
  return (
    dtMs > 0
    && dtMs < GPS_LAYER_A_ACTIVE_TELEPORT_MAX_DT_MS
    && distM > GPS_LAYER_A_ACTIVE_TELEPORT_M
  );
}
