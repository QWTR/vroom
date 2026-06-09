import { MotionStateMachine } from './motionState';

describe('MotionStateMachine', () => {
  it('starts stopped until MOTION_MIN_DIST_M movement with good accuracy', () => {
    const m = new MotionStateMachine();
    m.reset({ lat: 52, lng: 19 });
    expect(m.update({ lat: 52.000001, lng: 19.000001, accuracy: 10, timestamp: 1000 }, { positionTrusted: true })).toBe(false);
    expect(m.update({ lat: 52.000005, lng: 19.000005, accuracy: 10, timestamp: 2000 }, { positionTrusted: true })).toBe(false);
    expect(m.update({ lat: 52.00002, lng: 19, accuracy: 10, timestamp: 3000 }, { positionTrusted: true })).toBe(true);
  });

  it('wakes from stop on DEGRADED when displacement >= 10m', () => {
    const m = new MotionStateMachine();
    m.reset({ lat: 52, lng: 19 });
    expect(
      m.update(
        { lat: 52.00012, lng: 19, accuracy: 40, timestamp: 2000 },
        { positionTrusted: false, qualityVerdict: 'DEGRADED' },
      ),
    ).toBe(true);
  });

  it('returns to stop after 3 clustered fixes', () => {
    const m = new MotionStateMachine();
    m.reset({ lat: 52, lng: 19 });
    m.update({ lat: 52.0001, lng: 19, accuracy: 8, timestamp: 1000 }, { positionTrusted: true });
    expect(m.getSnapshot().isMoving).toBe(true);
    m.update({ lat: 52.000101, lng: 19.000001, accuracy: 8, timestamp: 2000 }, { positionTrusted: true });
    m.update({ lat: 52.000102, lng: 19.000002, accuracy: 8, timestamp: 3000 }, { positionTrusted: true });
    expect(m.update({ lat: 52.000103, lng: 19.000003, accuracy: 8, timestamp: 4000 }, { positionTrusted: true })).toBe(false);
  });
});
