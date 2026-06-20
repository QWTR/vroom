import { describe, expect, it } from 'vitest';
import {
  getNavigationSpeechPhase,
  projectPointToRouteWindow,
} from '../scripts/navigationUtils';
import { resolveRerouteApiHeadingDeg, routeStartsWithUTurn } from '../lib/navigation/reroute';

describe('real-time navigation behavior', () => {
  it('fires a crossed speech threshold even when a GPS sample skips its band', () => {
    expect(getNavigationSpeechPhase(42, 125)).toBe('now');
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
});
