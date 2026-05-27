export class KalmanFilter {
  private processNoise:       number;
  private measurementNoise:   number;
  private estimatedError:     number;
  private lastEstimate:       number | null;
  private velocity:           number;
  private lastTime:           number | null;

  constructor(processNoise = 0.0001, measurementNoise = 0.01) {
    this.processNoise      = processNoise;
    this.measurementNoise  = measurementNoise;
    this.estimatedError    = 1.0;
    this.lastEstimate      = null;
    this.velocity          = 0;
    this.lastTime          = null;
  }

  filter(measurement: number, accuracy: number): number {
    const now = Date.now();

    if (this.lastEstimate === null) {
      this.lastEstimate = measurement;
      this.lastTime     = now;
      return measurement;
    }

    const dt = this.lastTime !== null ? (now - this.lastTime) / 1000 : 0.5;
    this.lastTime = now;

    // Predykcja
    const predicted      = this.lastEstimate + this.velocity * dt;
    const predictedError = this.estimatedError + this.processNoise * dt;

    // Skaluj szum przez accuracy
    const dynamicNoise = this.measurementNoise * Math.max(1, accuracy / 5);
    const kalmanGain   = predictedError / (predictedError + dynamicNoise);

    const currentEstimate   = predicted + kalmanGain * (measurement - predicted);
    this.estimatedError     = (1.0 - kalmanGain) * predictedError;

    if (dt > 0) {
      const rawVelocity = (currentEstimate - (this.lastEstimate ?? currentEstimate)) / dt;
      this.velocity     = this.velocity * 0.7 + rawVelocity * 0.3;
    }

    this.lastEstimate = currentEstimate;
    return currentEstimate;
  }

  // Miękki reset — zachowaj pozycję ale zresetuj velocity i błąd
  resetToPosition(lat: number, lng: number): void {
    this.lastEstimate   = lat; // używane tylko przez jeden filtr naraz
    this.estimatedError = 1.0;
    this.velocity       = 0;
    this.lastTime       = null;
  }

  reset(): void {
    this.lastEstimate   = null;
    this.estimatedError = 1.0;
    this.velocity       = 0;
    this.lastTime       = null;
  }

  /** Runtime tuning (driving filters) — wyższe Q / niższe R = szybsza reakcja na GPS. */
  setNoise(processNoise: number, measurementNoise: number): void {
    this.processNoise = Math.max(1e-6, processNoise);
    this.measurementNoise = Math.max(1e-6, measurementNoise);
  }

  getLastEstimate(): number | null {
    return this.lastEstimate;
  }
}

const DRIVING_KALMAN_Q_BASE = 0.005;
const DRIVING_KALMAN_R_BASE = 0.005;
const DRIVING_KALMAN_Q_FAST = 0.032;
const DRIVING_KALMAN_R_FAST = 0.0012;
const DRIVING_KALMAN_SPEED_ON_KMH = 20;
const DRIVING_KALMAN_SPEED_FULL_KMH = 75;

/**
 * Przy >20 km/h podbija process noise i obniża measurement noise —
 * filtr szybciej „dogania” surowy GPS w zakrętach i na prostej.
 */
function applySpeedResponsiveKalman(
  speedKmh: number,
  latF: KalmanFilter,
  lngF: KalmanFilter,
  qBase: number,
  rBase: number,
  qFast: number,
  rFast: number,
): void {
  if (!Number.isFinite(speedKmh) || speedKmh < DRIVING_KALMAN_SPEED_ON_KMH) {
    latF.setNoise(qBase, rBase);
    lngF.setNoise(qBase, rBase);
    return;
  }
  const t = Math.min(
    1,
    (speedKmh - DRIVING_KALMAN_SPEED_ON_KMH)
      / (DRIVING_KALMAN_SPEED_FULL_KMH - DRIVING_KALMAN_SPEED_ON_KMH),
  );
  const q = qBase + (qFast - qBase) * t;
  const r = rBase + (rFast - rBase) * t;
  latF.setNoise(q, r);
  lngF.setNoise(q, r);
}

export function configureDrivingKalmanForSpeed(speedKmh: number): void {
  applySpeedResponsiveKalman(
    speedKmh,
    drivLatFilter,
    drivLngFilter,
    DRIVING_KALMAN_Q_BASE,
    DRIVING_KALMAN_R_BASE,
    DRIVING_KALMAN_Q_FAST,
    DRIVING_KALMAN_R_FAST,
  );
}

export function configureNavKalmanForSpeed(speedKmh: number): void {
  applySpeedResponsiveKalman(
    speedKmh,
    navLatFilter,
    navLngFilter,
    0.001,
    0.005,
    0.018,
    0.0015,
  );
}

// ── isSaneLocation — max 200 m/s (720 km/h) między odczytami ──
// Ale uwzględnij czas — sprawdzaj prędkość, nie odległość
export function isSaneLocation(
  newLat:     number,
  newLng:     number,
  prevLat:    number,
  prevLng:    number,
  maxSpeedKmh = 250, // max rozsądna prędkość pojazdu
  dtMs        = 1000, // czas od ostatniego odczytu w ms
  isDriving   = false, // tryb jazdy — pozwala na większe skoki (GPS dryft przy dużej prędkości)
): boolean {
  const R    = 6371000;
  const dLat = ((newLat - prevLat) * Math.PI) / 180;
  const dLng = ((newLng - prevLng) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((prevLat * Math.PI) / 180) *
    Math.cos((newLat  * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const distM    = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const speedKmh = (distM / (dtMs / 1000)) * 3.6;
  // W trybie jazdy dopuszczamy większy próg prędkości (GPS multipath na autostradzie)
  const effectiveMax = isDriving ? Math.max(maxSpeedKmh, 350) : maxSpeedKmh;
  return speedKmh <= effectiveMax;
}

export const latFilter    = new KalmanFilter(0.0001, 0.01);
export const lngFilter    = new KalmanFilter(0.0001, 0.01);
export const navLatFilter = new KalmanFilter(0.001,  0.005);
export const navLngFilter = new KalmanFilter(0.001,  0.005);
// Tryb jazdy: wyższy processNoise (szybsza reakcja na zakręty/zmiany kierunku)
export const drivLatFilter = new KalmanFilter(0.005, 0.005);
export const drivLngFilter = new KalmanFilter(0.005, 0.005);