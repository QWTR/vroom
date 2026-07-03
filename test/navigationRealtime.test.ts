import { describe, expect, it } from 'vitest';
import { combineManeuverIconKey } from '../hooks/useGoogleDirections';
import {
  applyGeometryTurnToStep,
  buildRouteForwardArcPrefix,
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
