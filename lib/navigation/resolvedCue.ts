import type { DirectionsResult, Step } from '../../hooks/useGoogleDirections';
import {
  applyGeometryTurnToStep,
  buildRouteForwardArcPrefix,
  buildStepArcIndex,
  formatNavigationInstruction,
  inferGeometryTurn,
  type StepArcIndex,
} from '../../scripts/navigationUtils';

export type ResolvedTurnDirection = 'left' | 'right' | 'straight' | null;

export interface ResolvedNavigationCue {
  stepIndex: number;
  step: Step;
  instruction: string;
  maneuver: string;
  maneuverModifier: string;
  maneuverExit: number | null;
  direction: ResolvedTurnDirection;
  distanceM: number | null;
  routeRevision: string;
  geometryCorrected: boolean;
  originalManeuver: string;
  originalManeuverModifier: string;
  originalDirection: ResolvedTurnDirection;
  geometryDirection: ResolvedTurnDirection;
  correctionConfidence: number;
}

export interface ResolvedNavigationRoute extends DirectionsResult {
  routeRevision: string;
  stepArcIndex: StepArcIndex[];
  geometryCorrectionCount: number;
  geometryDiagnostics: NavigationGeometryDiagnostic[];
}

export type NavigationGeometryDiagnostic = {
  stepIndex: number;
  originalDirection: ResolvedTurnDirection;
  geometryDirection: ResolvedTurnDirection;
  confidence: number;
  corrected: boolean;
};

function normalized(value: unknown): string {
  return String(value ?? '').toLowerCase().trim().replace(/_/g, '-').replace(/\s+/g, '-');
}

export function directionFromStep(step: Step | null | undefined): ResolvedTurnDirection {
  if (!step) return null;
  const maneuver = normalized(step.maneuver);
  const modifier = normalized(step.maneuverModifier);
  const combined = `${maneuver}-${modifier}`;
  if (combined.includes('uturn') || combined.includes('u-turn')) {
    if (combined.includes('right')) return 'right';
    return 'left';
  }
  if (combined.includes('left')) return 'left';
  if (combined.includes('right')) return 'right';
  if (
    maneuver === 'straight'
    || maneuver === 'continue'
    || maneuver === 'continue-straight'
    || modifier === 'straight'
    || maneuver === 'depart'
  ) {
    return 'straight';
  }
  return null;
}

export function createNavigationRouteRevision(
  points: { latitude: number; longitude: number }[],
  steps: Step[],
): string {
  const first = points[0];
  const last = points[points.length - 1];
  const coordinate = (value: number | undefined) => Number(value ?? 0).toFixed(5);
  const stride = Math.max(1, Math.floor(points.length / 12));
  const sampledGeometry = points
    .filter((_, index) => index % stride === 0 || index === points.length - 1)
    .map((point) => `${coordinate(point.latitude)},${coordinate(point.longitude)}`)
    .join(';');
  const stepSignature = steps
    .map((step) => `${step.maneuver ?? ''}:${step.maneuverModifier ?? ''}`)
    .join('|');
  const signature = `${sampledGeometry}#${stepSignature}`;
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return [
    points.length,
    steps.length,
    coordinate(first?.latitude),
    coordinate(first?.longitude),
    coordinate(last?.latitude),
    coordinate(last?.longitude),
    (hash >>> 0).toString(36),
  ].join(':');
}

export function resolveNavigationRoute(route: DirectionsResult): ResolvedNavigationRoute {
  const points = route.points ?? [];
  const originalSteps = route.steps ?? [];
  const stepArcIndex = buildStepArcIndex(points, originalSteps);
  const forwardPrefix = buildRouteForwardArcPrefix(points);
  let geometryCorrectionCount = 0;
  const geometryDiagnostics: NavigationGeometryDiagnostic[] = [];

  const steps = originalSteps.map((step, stepIndex) => {
    const arc = stepArcIndex[stepIndex];
    if (!arc || points.length < 2) {
      geometryDiagnostics.push({
        stepIndex,
        originalDirection: directionFromStep(step),
        geometryDirection: null,
        confidence: 0,
        corrected: false,
      });
      return step;
    }
    const inference = inferGeometryTurn(points, arc.startArcM, forwardPrefix);
    const resolved = applyGeometryTurnToStep(step, points, arc, forwardPrefix);
    const corrected = (
      resolved.maneuver !== step.maneuver
      || resolved.maneuverModifier !== step.maneuverModifier
    );
    if (corrected) {
      geometryCorrectionCount += 1;
    }
    geometryDiagnostics.push({
      stepIndex,
      originalDirection: directionFromStep(step),
      geometryDirection: inference?.direction ?? null,
      confidence: inference?.confidence ?? 0,
      corrected,
    });
    return resolved;
  });

  return {
    ...route,
    steps,
    routeRevision: createNavigationRouteRevision(points, originalSteps),
    stepArcIndex,
    geometryCorrectionCount,
    geometryDiagnostics,
  };
}

export function createResolvedNavigationCue(input: {
  stepIndex: number;
  step: Step;
  originalStep?: Step | null;
  distanceM?: number | null;
  routeRevision: string;
  geometryDiagnostic?: NavigationGeometryDiagnostic | null;
}): ResolvedNavigationCue {
  const originalStep = input.originalStep ?? input.step;
  const diagnostic = input.geometryDiagnostic;
  return {
    stepIndex: input.stepIndex,
    step: input.step,
    instruction: formatNavigationInstruction(input.step),
    maneuver: input.step.maneuver ?? 'navigation',
    maneuverModifier: input.step.maneuverModifier ?? '',
    maneuverExit: input.step.maneuverExit ?? null,
    direction: directionFromStep(input.step),
    distanceM: input.distanceM != null && Number.isFinite(input.distanceM)
      ? Math.max(0, input.distanceM)
      : null,
    routeRevision: input.routeRevision,
    geometryCorrected:
      input.step.maneuver !== originalStep.maneuver
      || input.step.maneuverModifier !== originalStep.maneuverModifier,
    originalManeuver: originalStep.maneuver ?? '',
    originalManeuverModifier: originalStep.maneuverModifier ?? '',
    originalDirection: diagnostic?.originalDirection ?? directionFromStep(originalStep),
    geometryDirection: diagnostic?.geometryDirection ?? null,
    correctionConfidence: diagnostic?.confidence ?? 0,
  };
}

export function resolvedCueKey(cue: ResolvedNavigationCue): string {
  const distanceBucket = cue.distanceM == null ? 'x' : String(Math.round(cue.distanceM / 10));
  return [
    cue.routeRevision,
    cue.stepIndex,
    cue.maneuver,
    cue.maneuverModifier,
    distanceBucket,
  ].join(':');
}
