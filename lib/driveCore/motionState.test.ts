import { MotionStateMachine } from './motionState';

describe('MotionStateMachine', () => {
  it('starts stopped until 3m movement with good accuracy', () => {
    const m = new MotionStateMachine();
    m.reset({ lat: 52, lng: 19 });
    expect(m.update({ lat: 52.00001, lng: 19.00001, accuracy: 10, timestamp: 1000 })).toBe(false);
    expect(m.update({ lat: 52.00005, lng: 19.00005, accuracy: 10, timestamp: 2000 })).toBe(false);
    expect(m.update({ lat: 52.00008, lng: 19, accuracy: 10, timestamp: 3000 })).toBe(true);
  });

  it('returns to stop after 3 clustered fixes', () => {
    const m = new MotionStateMachine();
    m.reset({ lat: 52, lng: 19 });
    m.update({ lat: 52.0001, lng: 19, accuracy: 8, timestamp: 1000 });
    expect(m.getSnapshot().isMoving).toBe(true);
    m.update({ lat: 52.000101, lng: 19.000001, accuracy: 8, timestamp: 2000 });
    m.update({ lat: 52.000102, lng: 19.000002, accuracy: 8, timestamp: 3000 });
    expect(m.update({ lat: 52.000103, lng: 19.000003, accuracy: 8, timestamp: 4000 })).toBe(false);
  });
});
