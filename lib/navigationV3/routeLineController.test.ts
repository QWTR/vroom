import { describe, expect, it } from 'vitest';
import { createRouteLineController, type RouteLinePoint } from './routeLineController';

const points: RouteLinePoint[] = [
  { latitude: 52, longitude: 21 },
  { latitude: 52.001, longitude: 21 },
  { latitude: 52.001, longitude: 21.002 },
  { latitude: 52.002, longitude: 21.002 },
];
function setup() {
  const controller = createRouteLineController();
  const revision = controller.replace(points);
  const input = { revision, latitude: 52.0008, longitude: 21.0001, visible: true, offRoute: false, now: 1000, radiusM: 50 };
  return { controller, input };
}

describe('remaining route geometry', () => {
  it('projects onto the segment and retains the turn vertex even when the next vertex is closer', () => {
    const { controller, input } = setup();
    const line = controller.update(input)!;
    expect(line[0].longitude).toBeCloseTo(21, 7);
    expect(line.slice(1)).toEqual(points.slice(1));
  });
  it('does not rebuild on HUD renders, small motion, or faster than one second', () => {
    const { controller, input } = setup();
    expect(controller.update(input)).not.toBeNull();
    expect(controller.update({ ...input, now: 10000 })).toBeNull();
    expect(controller.update({ ...input, latitude: 52.0009, now: 1500 })).toBeNull();
    expect(controller.update({ ...input, latitude: 52.0009, now: 2000 })).not.toBeNull();
  });
  it('updates immediately on a segment change without drawing a shortcut across the turn', () => {
    const { controller, input } = setup();
    controller.update(input);
    const line = controller.update({ ...input, latitude: 52.001, longitude: 21.001, now: 1100 })!;
    expect(line.slice(1)).toEqual(points.slice(2));
    expect(line[0].latitude).toBeCloseTo(52.001, 7);
  });
  it('holds the last line off route or hidden and resumes with the latest position', () => {
    const { controller, input } = setup();
    controller.update(input);
    expect(controller.update({ ...input, visible: false, now: 5000 })).toBeNull();
    expect(controller.update({ ...input, offRoute: true, now: 5000 })).toBeNull();
    expect(controller.update({ ...input, longitude: 22, now: 5000 })).toBeNull();
    expect(controller.update({ ...input, latitude: 52.0015, longitude: 21.002, now: 6000 })?.slice(1)).toEqual(points.slice(3));
  });
  it('rejects stale geometry revisions and backward GPS noise', () => {
    const { controller, input } = setup();
    controller.update(input);
    expect(controller.update({ ...input, latitude: 52.0005, now: 3000 })).toBeNull();
    const revision = controller.replace(points.map(p => ({ ...p })));
    expect(controller.update({ ...input, now: 3000 })).toBeNull();
    expect(controller.update({ ...input, revision, now: 3000 })).not.toBeNull();
  });
});
