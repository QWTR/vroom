export class KalmanFilter {
  private processNoise: number;
  private measurementNoise: number;
  private estimatedError: number;
  private lastEstimate: number | null;

  constructor(processNoise = 0.00001, measurementNoise = 0.0001) {
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
    this.estimatedError = 1.0;
    this.lastEstimate = null;
  }

  filter(measurement: number, accuracy: number): number {
    if (this.lastEstimate === null) {
      this.lastEstimate = measurement;
      return measurement;
    }
    const kalmanGain = this.estimatedError / (this.estimatedError + accuracy * this.measurementNoise);
    const currentEstimate = this.lastEstimate + kalmanGain * (measurement - this.lastEstimate);
    this.estimatedError = (1.0 - kalmanGain) * (this.estimatedError + this.processNoise);
    this.lastEstimate = currentEstimate;
    return currentEstimate;
  }

  reset(): void {
    this.lastEstimate = null;
    this.estimatedError = 1.0;
  }
}

export const latFilter = new KalmanFilter();
export const lngFilter = new KalmanFilter();