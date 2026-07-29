export const AUTOMOTIVE_SNAPSHOT_SCHEMA_VERSION = 2;

export interface AutomotiveCoordinate {
  latitude: number;
  longitude: number;
}

export interface AutomotiveSnapshot<TDto = unknown, TMapState = unknown> {
  schemaVersion: number;
  revision: number;
  sentAtMs: number;
  source: 'phone' | 'carplay' | 'android_auto';
  isNavigating: boolean;
  dto: TDto;
  route: unknown[];
  destination: unknown;
  userLocation: AutomotiveCoordinate | null;
  speed: number | null;
  heading: number | null;
  users: unknown[];
  warnings: unknown[];
  mapState: TMapState;
}

let lastRevision = 0;

export function nextAutomotiveRevision(now = Date.now()): number {
  lastRevision = Math.max(lastRevision + 1, Math.trunc(now));
  return lastRevision;
}

export function createAutomotiveSnapshot<TDto, TMapState>(input: {
  isNavigating: boolean;
  dto: TDto;
  route: unknown[];
  destination: unknown;
  userLocation?: AutomotiveCoordinate | null;
  speedMetersPerSecond?: number | null;
  heading?: number | null;
  users: unknown[];
  warnings: unknown[];
  mapState: TMapState;
  now?: number;
}): AutomotiveSnapshot<TDto, TMapState> {
  const sentAtMs = Math.trunc(input.now ?? Date.now());
  return {
    schemaVersion: AUTOMOTIVE_SNAPSHOT_SCHEMA_VERSION,
    revision: nextAutomotiveRevision(sentAtMs),
    sentAtMs,
    source: 'phone',
    isNavigating: input.isNavigating,
    dto: input.dto,
    route: input.route,
    destination: input.destination,
    userLocation: input.userLocation ?? null,
    speed: finiteOrNull(input.speedMetersPerSecond),
    heading: finiteOrNull(input.heading),
    users: input.users,
    warnings: input.warnings,
    mapState: input.mapState,
  };
}

export function normalizeAutomotiveNavigationStarted(event: unknown): {
  routePoints: AutomotiveCoordinate[];
  destination: (AutomotiveCoordinate & { name: string }) | null;
  distanceMeters: number;
  durationSeconds: number;
  instruction: string;
  routePreview: boolean;
  selectedRouteIndex: number;
} | null {
  const parsed = typeof event === 'string'
    ? safeParseJSON(event)
    : event as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, any>;
  const rawRoute = root?.mapState?.route ?? root?.route ?? [];
  const routePoints = Array.isArray(rawRoute)
    ? rawRoute.map((point) => ({
        latitude: Number(point?.latitude ?? point?.lat),
        longitude: Number(point?.longitude ?? point?.lng),
      })).filter(isCoordinate)
    : [];
  if (routePoints.length < 2) return null;
  const rawDestination = root?.destination;
  const destinationCandidate = {
    latitude: Number(rawDestination?.latitude ?? rawDestination?.lat),
    longitude: Number(rawDestination?.longitude ?? rawDestination?.lng),
  };
  const destination = isCoordinate(destinationCandidate)
    ? {
        ...destinationCandidate,
        name: String(rawDestination?.name ?? 'Cel'),
      }
    : null;
  const firstStep = Array.isArray(root?.routeSteps) ? root.routeSteps[0] : null;
  return {
    routePoints,
    destination,
    distanceMeters: finiteNumber(
      root?.dto?.remainingDistanceMeters
      ?? root?.distanceMeters
      ?? root?.distanceM,
    ),
    durationSeconds: finiteNumber(
      root?.dto?.remainingDurationSec
      ?? root?.dto?.remainingDurationSeconds
      ?? root?.durationSeconds
      ?? root?.durationS,
    ),
    instruction: String(
      root?.dto?.nextInstruction
      ?? firstStep?.instruction
      ?? '',
    ),
    routePreview:
      root?.mapState?.routePreview === true
      || root?.isNavigating === false,
    selectedRouteIndex: finiteNumber(
      root?.mapState?.selectedRouteIndex ?? root?.selectedRouteIndex,
    ),
  };
}

function safeParseJSON(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isCoordinate(
  value: AutomotiveCoordinate,
): value is AutomotiveCoordinate {
  return Number.isFinite(value.latitude)
    && Number.isFinite(value.longitude)
    && Math.abs(value.latitude) <= 90
    && Math.abs(value.longitude) <= 180;
}
