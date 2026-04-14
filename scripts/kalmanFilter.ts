export class KalmanFilter {
  private processNoise: number;
  private measurementNoise: number;
  private estimatedError: number;
  private lastEstimate: number | null;
  private velocity: number;
  private lastTime: number | null;

  constructor(processNoise = 0.0001, measurementNoise = 0.01) {
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
    this.estimatedError = 1.0;
    this.lastEstimate = null;
    this.velocity = 0;
    this.lastTime = null;
  }

  filter(measurement: number, accuracy: number): number {
    const now = Date.now();

    if (this.lastEstimate === null) {
      this.lastEstimate = measurement;
      this.lastTime = now;
      return measurement;
    }

    // Oblicz dt w sekundach
    const dt = this.lastTime !== null ? (now - this.lastTime) / 1000 : 0.5;
    this.lastTime = now;

    // Predykcja z velocity
    const predicted = this.lastEstimate + this.velocity * dt;
    const predictedError = this.estimatedError + this.processNoise * dt;

    // Skaluj szum pomiaru przez accuracy GPS (im gorszy GPS tym mniej ufamy)
    const dynamicMeasurementNoise = this.measurementNoise * Math.max(1, accuracy / 5);

    // Kalman gain
    const kalmanGain = predictedError / (predictedError + dynamicMeasurementNoise);

    // Update
    const currentEstimate = predicted + kalmanGain * (measurement - predicted);
    this.estimatedError = (1.0 - kalmanGain) * predictedError;

    // Aktualizuj velocity (wygładzone)
    if (dt > 0) {
      const rawVelocity = (currentEstimate - this.lastEstimate) / dt;
      this.velocity = this.velocity * 0.7 + rawVelocity * 0.3;
    }

    this.lastEstimate = currentEstimate;
    return currentEstimate;
  }

  reset(): void {
    this.lastEstimate = null;
    this.estimatedError = 1.0;
    this.velocity = 0;
    this.lastTime = null;
  }
}

export function isSaneLocation(
  newLat: number,
  newLng: number,
  prevLat: number | null,
  prevLng: number | null,
  maxJumpKm = 50,
): boolean {
  if (prevLat === null || prevLng === null) return true;
  // Szybki haversine
  const R    = 6371;
  const dLat = ((newLat - prevLat) * Math.PI) / 180;
  const dLng = ((newLng - prevLng) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((prevLat * Math.PI) / 180) *
    Math.cos((newLat  * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distKm <= maxJumpKm;
}

// Osobne filtry dla nawigacji (agresywniejsze) i podglądu (spokojniejsze)
export const latFilter = new KalmanFilter(0.0001, 0.01);
export const lngFilter = new KalmanFilter(0.0001, 0.01);

// Filtry nawigacyjne — szybciej reagują na ruch
export const navLatFilter = new KalmanFilter(0.001, 0.005);
export const navLngFilter = new KalmanFilter(0.001, 0.005);