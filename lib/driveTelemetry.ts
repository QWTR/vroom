export type DriveTelemetrySource = 'foreground' | 'background' | 'native' | 'recovered';

export type DriveTelemetryPoint = {
  latitude: number;
  longitude: number;
  recordedAt?: string | null;
  speedKmh?: number | null;
  altitudeM?: number | null;
  accuracyM?: number | null;
  headingDeg?: number | null;
  source?: DriveTelemetrySource | string | null;
  accepted?: boolean;
};

const finiteOrNull = (value: unknown, min: number, max: number): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= min && numberValue <= max
    ? numberValue
    : null;
};

export function sanitizeDriveTelemetryPoint(value: any): DriveTelemetryPoint | null {
  const latitude = finiteOrNull(value?.latitude, -90, 90);
  const longitude = finiteOrNull(value?.longitude, -180, 180);
  if (latitude == null || longitude == null) return null;

  const timestamp = value?.recordedAt == null ? null : new Date(value.recordedAt);
  const recordedAt = timestamp && Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString()
    : null;

  const point: DriveTelemetryPoint = {
    latitude,
    longitude,
  };
  if ('recordedAt' in value) point.recordedAt = recordedAt;
  if ('speedKmh' in value) point.speedKmh = finiteOrNull(value?.speedKmh, 0, 420);
  if ('altitudeM' in value) point.altitudeM = finiteOrNull(value?.altitudeM, -500, 10_000);
  if ('accuracyM' in value) point.accuracyM = finiteOrNull(value?.accuracyM, 0, 10_000);
  if ('headingDeg' in value) point.headingDeg = finiteOrNull(value?.headingDeg, 0, 360);
  if ('source' in value) point.source = typeof value?.source === 'string' ? value.source : null;
  if ('accepted' in value) point.accepted = value?.accepted !== false;
  return point;
}

function importantPoint(point: DriveTelemetryPoint, previous?: DriveTelemetryPoint, next?: DriveTelemetryPoint) {
  if (point.accepted === false) return true;
  if (point.speedKmh != null && point.speedKmh < 3) return true;
  if (!previous || !next) return true;
  const speed = point.speedKmh;
  const previousSpeed = previous.speedKmh;
  const nextSpeed = next.speedKmh;
  if (speed != null && previousSpeed != null && Math.abs(speed - previousSpeed) >= 12) return true;
  if (speed != null && nextSpeed != null && Math.abs(nextSpeed - speed) >= 12) return true;
  const altitude = point.altitudeM;
  if (altitude != null && previous.altitudeM != null && Math.abs(altitude - previous.altitudeM) >= 8) return true;
  return false;
}

/**
 * Keeps the full telemetry contract while bounding payload size. First/last,
 * stops, speed changes and altitude extrema survive before uniform sampling.
 */
export function compactDriveTelemetry(points: DriveTelemetryPoint[], maxPoints = 3_000): DriveTelemetryPoint[] {
  const clean: DriveTelemetryPoint[] = [];
  for (const rawPoint of points) {
    const point = sanitizeDriveTelemetryPoint(rawPoint);
    if (!point) continue;
    const previous = clean[clean.length - 1];
    if (
      previous
      && Math.abs(previous.latitude - point.latitude) < 1e-7
      && Math.abs(previous.longitude - point.longitude) < 1e-7
      && previous.recordedAt === point.recordedAt
    ) continue;
    clean.push(point);
  }
  if (clean.length <= maxPoints) return clean;

  const selected = new Set<number>([0, clean.length - 1]);
  clean.forEach((point, index) => {
    if (importantPoint(point, clean[index - 1], clean[index + 1])) selected.add(index);
  });

  if (selected.size < maxPoints) {
    const remaining = maxPoints - selected.size;
    const stride = Math.max(1, Math.ceil(clean.length / remaining));
    for (let index = 0; index < clean.length && selected.size < maxPoints; index += stride) {
      selected.add(index);
    }
  }

  const sorted = [...selected].sort((left, right) => left - right);
  if (sorted.length > maxPoints) {
    const thinned = Array.from({ length: maxPoints }, (_, index) => sorted[Math.round((index * (sorted.length - 1)) / (maxPoints - 1))]);
    return [...new Set(thinned)].map((index) => clean[index]);
  }
  return sorted.map((index) => clean[index]);
}
