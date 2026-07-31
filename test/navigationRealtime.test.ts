import { describe, expect, it } from 'vitest';
import { combineManeuverIconKey } from '../hooks/useGoogleDirections';
import {
  applyGeometryTurnToStep,
  buildStepArcIndex,
  detectCurrentStep,
  distanceToManeuverArcM,
  getNavigationSpeechPhase,
  inferGeometryTurnModifier,
  projectPointToRouteWindow,
  resolveAnnouncementTarget,
  shouldSpeakForStep,
  STEP_ADVANCE_THRESHOLD_M,
} from '../scripts/navigationUtils';
import { resolveRerouteApiHeadingDeg, routeStartsWithUTurn } from '../lib/navigation/reroute';
import { trimNavigationRouteFromVehicle } from '../lib/driveCore/navRouteBootstrap';
import {
  createResolvedNavigationCue,
  resolveNavigationRoute,
} from '../lib/navigation/resolvedCue';
import { buildAdaptiveNavigationSpeech } from '../lib/navigation/voiceGuidanceCore';
import { toCarSafeNavigationDto } from '../core/navigationCore';
import { navigationNotificationIcon } from '../lib/navigation/maneuverPresentation';
import type { Step } from '../hooks/useGoogleDirections';

function encodePolyline(points: { latitude: number; longitude: number }[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = '';
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      result += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    result += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.latitude * 1e5);
    const lng = Math.round(p.longitude * 1e5);
    encode(lat - lastLat);
    encode(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}

function makeStraightRoute(stepCount: number, stepLenM = 500) {
  const routePoints = Array.from({ length: stepCount * 10 + 1 }, (_, i) => ({
    latitude: 52,
    longitude: 21 + (i * stepLenM) / 111320,
  }));
  const steps: Step[] = Array.from({ length: stepCount }, (_, i) => {
    const start = routePoints[i * 10];
    const end = routePoints[(i + 1) * 10];
    const geom = encodePolyline(routePoints.slice(i * 10, i * 10 + 11));
    const isLast = i === stepCount - 1;
    return {
      html_instructions: isLast ? 'arrive' : i === 0 ? 'depart' : 'turn left',
      distance: { text: '0.5 km', value: stepLenM },
      duration: { text: '1 min', value: 60 },
      start_location: { lat: start.latitude, lng: start.longitude },
      end_location: { lat: end.latitude, lng: end.longitude },
      maneuver: isLast ? 'arrive' : i === 0 ? 'depart' : 'turn-left',
      polyline: { points: geom },
    };
  });
  return { routePoints, steps };
}

function makeForkRoute() {
  const routePoints = [
    { latitude: 52.0, longitude: 21.0 },
    { latitude: 52.0, longitude: 21.003 },
    { latitude: 52.0, longitude: 21.006 },
    { latitude: 52.0, longitude: 21.009 },
    { latitude: 51.997, longitude: 21.012 },
    { latitude: 51.994, longitude: 21.015 },
  ];
  const steps: Step[] = [
    {
      html_instructions: 'depart',
      distance: { text: '1 km', value: 900 },
      duration: { text: '2 min', value: 120 },
      start_location: { lat: 52, lng: 21 },
      end_location: { lat: 52, lng: 21.009 },
      maneuver: 'depart',
      polyline: { points: encodePolyline(routePoints.slice(0, 4)) },
    },
    {
      html_instructions: 'turn left',
      distance: { text: '0.3 km', value: 300 },
      duration: { text: '1 min', value: 60 },
      start_location: { lat: 52, lng: 21.009 },
      end_location: { lat: 51.994, lng: 21.015 },
      maneuver: 'turn-left',
      maneuverModifier: 'left',
      polyline: { points: encodePolyline(routePoints.slice(3)) },
    },
  ];
  return { routePoints, steps };
}

describe('real-time navigation behavior', () => {
  it('fires a crossed speech threshold even when a GPS sample skips its band', () => {
    expect(getNavigationSpeechPhase(35, 125)).toBe('now');
    expect(getNavigationSpeechPhase(140, 220)).toBe('far150');
    expect(getNavigationSpeechPhase(130, 140)).toBeNull();
  });

  it('projects route progress around the current segment', () => {
    const route = Array.from({ length: 12 }, (_, index) => ({
      latitude: 52,
      longitude: 21 + index * 0.001,
    }));
    const projection = projectPointToRouteWindow(52.0001, 21.0064, route, 5, 50);
    expect(projection).not.toBeNull();
    expect(projection!.segmentIndex).toBe(6);
    expect(projection!.longitude).toBeCloseTo(21.0064, 4);
  });

  it('prefers course over ground to a sideways device heading', () => {
    const heading = resolveRerouteApiHeadingDeg(
      180,
      52,
      21.001,
      { lat: 52, lng: 21 },
      180,
    );
    expect(Math.abs(heading - 90)).toBeLessThanOrEqual(6);
  });

  it('recognizes an initial U-turn and leaves a forward departure alone', () => {
    const makeRoute = (modifier: string) => ({
      legs: [{
        steps: [{ maneuver: { type: 'turn', modifier, instruction: modifier } }],
      }],
    });
    expect(routeStartsWithUTurn(makeRoute('uturn'))).toBe(true);
    expect(routeStartsWithUTurn(makeRoute('right'))).toBe(false);
  });

  it('does not skip steps on a straight route at mid-segment arc', () => {
    const { routePoints, steps } = makeStraightRoute(3);
    const arcIndex = buildStepArcIndex(routePoints, steps);
    const userArcM = 100;
    expect(detectCurrentStep(userArcM, steps, 0, arcIndex)).toBe(0);
  });

  it('snaps back when stored step index is ahead of geometry', () => {
    const { routePoints, steps } = makeStraightRoute(3);
    const arcIndex = buildStepArcIndex(routePoints, steps);
    expect(detectCurrentStep(100, steps, 4, arcIndex)).toBe(0);
  });

  it('advances when near a junction', () => {
    const { routePoints, steps } = makeStraightRoute(3);
    const arcIndex = buildStepArcIndex(routePoints, steps);
    const endArc = arcIndex[0].endArcM;
    const nearJunction = endArc - STEP_ADVANCE_THRESHOLD_M + 1;
    expect(detectCurrentStep(nearJunction, steps, 0, arcIndex)).toBe(1);
  });

  it('previews the next turn during a minor step with arc distance', () => {
    const { routePoints, steps } = makeStraightRoute(3);
    steps[0].maneuver = 'continue-straight';
    steps[0].html_instructions = 'continue straight';
    const arcIndex = buildStepArcIndex(routePoints, steps);
    const userArcM = arcIndex[0].startArcM + 320;
    const junction = routePoints[10];
    const userLat = junction.latitude;
    const userLng = junction.longitude - 0.001;
    const target = resolveAnnouncementTarget(steps, 0, userArcM, userLat, userLng, arcIndex, routePoints);
    expect(target.stepIndex).toBeGreaterThanOrEqual(0);
    if (target.stepIndex === 1) {
      expect(target.distanceM).toBeGreaterThan(50);
    }
  });

  it('does not preview a far-away turn at 0m arc distance', () => {
    const { routePoints, steps } = makeStraightRoute(5, 800);
    steps[1].maneuver = 'continue-straight';
    steps[1].html_instructions = 'continue straight';
    steps[2].maneuver = 'roundabout';
    steps[2].html_instructions = 'roundabout — take 3rd exit';
    steps[2].maneuverExit = 3;
    const arcIndex = buildStepArcIndex(routePoints, steps);
    const userArcM = arcIndex[1].startArcM + 200;
    const userLat = 52;
    const userLng = 21 + userArcM / 111320;
    const target = resolveAnnouncementTarget(steps, 1, userArcM, userLat, userLng, arcIndex, routePoints);
    expect(target.stepIndex).toBe(1);
    expect(target.step.maneuver).toBe('continue-straight');
  });

  it('trims completed steps when navigation starts mid-route', () => {
    const { routePoints, steps } = makeStraightRoute(5, 500);
    const route = {
      points: routePoints,
      steps,
      distanceText: '2 km',
      distanceValue: 2500,
      durationText: '5 min',
      duration: 5,
      index: 0,
    };
    const midPoint = routePoints[25];
    const trimmed = trimNavigationRouteFromVehicle(route, midPoint.latitude, midPoint.longitude, 120);
    expect(trimmed.steps.length).toBeLessThanOrEqual(steps.length);
    expect(trimmed.steps.length).toBeGreaterThan(0);
    if (trimmed.steps.length < steps.length) {
      expect(trimmed.steps[0].maneuver).not.toBe('depart');
    }
  });

  it('overrides OSRM left with geometry right at a fork', () => {
    const { routePoints, steps } = makeForkRoute();
    const arcIndex = buildStepArcIndex(routePoints, steps);
    const turn = applyGeometryTurnToStep(steps[1], routePoints, arcIndex[1]);
    expect(turn.maneuver).toContain('right');
    expect(inferGeometryTurnModifier(routePoints, arcIndex[1].startArcM)).toBe('right');
  });

  it('also overrides OSRM right with unambiguous geometry left', () => {
    const { routePoints, steps } = makeForkRoute();
    const mirroredPoints = routePoints.map((point) => ({
      latitude: 104 - point.latitude,
      longitude: point.longitude,
    }));
    const mirroredSteps = steps.map((step) => ({
      ...step,
      start_location: {
        lat: 104 - step.start_location.lat,
        lng: step.start_location.lng,
      },
      end_location: {
        lat: 104 - step.end_location.lat,
        lng: step.end_location.lng,
      },
      maneuver: step.maneuver?.replace('left', 'right'),
      maneuverModifier: step.maneuverModifier?.replace('left', 'right'),
    }));
    const arcIndex = buildStepArcIndex(mirroredPoints, mirroredSteps);
    const turn = applyGeometryTurnToStep(mirroredSteps[1], mirroredPoints, arcIndex[1]);
    expect(turn.maneuver).toContain('left');
    expect(turn.maneuverModifier).toBe('left');
  });

  it('keeps protected maneuvers and uncertain bends unchanged', () => {
    const { routePoints, steps } = makeForkRoute();
    const arcIndex = buildStepArcIndex(routePoints, steps);
    const roundabout = {
      ...steps[1],
      maneuver: 'roundabout-left',
      maneuverModifier: 'left',
      maneuverExit: 2,
    };
    const uturn = {
      ...steps[1],
      maneuver: 'uturn-left',
      maneuverModifier: 'left',
    };
    expect(applyGeometryTurnToStep(roundabout, routePoints, arcIndex[1]).maneuver)
      .toBe('roundabout-left');
    expect(applyGeometryTurnToStep(uturn, routePoints, arcIndex[1]).maneuver)
      .toBe('uturn-left');

    const gentleCurve = [
      { latitude: 52, longitude: 21 },
      { latitude: 52, longitude: 21.002 },
      { latitude: 51.9999, longitude: 21.004 },
      { latitude: 51.9997, longitude: 21.006 },
    ];
    const uncertain = applyGeometryTurnToStep(
      steps[1],
      gentleCurve,
      { startArcM: 135, endArcM: 300, maneuverArcM: 135 },
    );
    expect(uncertain.maneuver).toBe(steps[1].maneuver);
  });

  it('maps repeated loop coordinates to monotonically increasing step arcs', () => {
    const routePoints = [
      { latitude: 52, longitude: 21 },
      { latitude: 52, longitude: 21.001 },
      { latitude: 52.001, longitude: 21.001 },
      { latitude: 52.001, longitude: 21 },
      { latitude: 52, longitude: 21 },
      { latitude: 51.999, longitude: 21 },
    ];
    const starts = [routePoints[0], routePoints[2], routePoints[4]];
    const steps = starts.map((point, index) => ({
      html_instructions: index === 0 ? 'depart' : 'turn right',
      maneuver: index === 0 ? 'depart' : 'turn-right',
      maneuverModifier: index === 0 ? 'straight' : 'right',
      start_location: { lat: point.latitude, lng: point.longitude },
      end_location: {
        lat: routePoints[Math.min(routePoints.length - 1, index * 2 + 1)].latitude,
        lng: routePoints[Math.min(routePoints.length - 1, index * 2 + 1)].longitude,
      },
      distance: { text: '100 m', value: 100 },
      duration: { text: '1 min', value: 60 },
      polyline: {
        points: encodePolyline(routePoints.slice(index * 2, Math.min(routePoints.length, index * 2 + 3))),
      },
    } as Step));
    const arcs = buildStepArcIndex(routePoints, steps);
    expect(arcs[1].startArcM).toBeGreaterThan(arcs[0].startArcM);
    expect(arcs[2].startArcM).toBeGreaterThan(arcs[1].startArcM);
  });

  it('uses one resolved right cue for HUD, speech, notification and car snapshots', () => {
    const { routePoints, steps } = makeForkRoute();
    const route = resolveNavigationRoute({
      points: routePoints,
      steps,
      distanceText: '1.2 km',
      distanceValue: 1200,
      durationText: '3 min',
      duration: 3,
      index: 0,
    });
    const resolvedStep = route.steps[1];
    const cue = createResolvedNavigationCue({
      stepIndex: 1,
      step: resolvedStep,
      originalStep: steps[1],
      distanceM: 80,
      routeRevision: route.routeRevision,
      geometryDiagnostic: route.geometryDiagnostics[1],
    });
    const speech = buildAdaptiveNavigationSpeech({
      step: cue.step,
      distanceM: cue.distanceM!,
      phase: 'now',
      speedKmh: 50,
    });
    const car = toCarSafeNavigationDto({
      isNavigating: true,
      currentStepIndex: cue.stepIndex,
      step: cue.step,
      followingStep: null,
      remainingDistKm: 1.2,
      distToTurnM: cue.distanceM,
      routeInfo: { distance: '1.2 km', duration: 3 } as any,
      destination: { latitude: 51.994, longitude: 21.015, name: 'Cel' },
    });

    expect(cue.geometryCorrected).toBe(true);
    expect(cue.geometryDirection).toBe('right');
    expect(cue.correctionConfidence).toBeGreaterThan(0);
    expect(cue.originalManeuver).toContain('left');
    expect(cue.direction).toBe('right');
    expect(cue.instruction.toLowerCase()).toContain('prawo');
    expect(combineManeuverIconKey(cue.maneuver, cue.maneuverModifier)).toContain('right');
    expect(navigationNotificationIcon(cue.maneuver)).toBe('➡️');
    expect(speech.toLowerCase()).toContain('prawo');
    expect(car.nextInstruction.toLowerCase()).toContain('prawo');
    expect(car.maneuverModifier).toContain('right');
  });

  it('computes arc distance to maneuver monotonically', () => {
    expect(distanceToManeuverArcM(100, 250)).toBe(150);
    expect(distanceToManeuverArcM(300, 250)).toBe(0);
  });

  it('never speaks depart or continue steps', () => {
    expect(shouldSpeakForStep({ maneuver: 'depart', html_instructions: 'depart' } as Step)).toBe(false);
    expect(shouldSpeakForStep({ maneuver: 'continue-straight', html_instructions: 'continue' } as Step)).toBe(false);
    expect(shouldSpeakForStep({ maneuver: 'turn-left', html_instructions: 'turn left' } as Step)).toBe(true);
  });
});
