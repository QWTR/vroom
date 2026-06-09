import { describe, expect, it } from 'vitest';
import { MicroSleepController } from './microSleep';

describe('MicroSleepController', () => {
  it('enters sleep after 3s below 0.5 km/h', () => {
    const ctrl = new MicroSleepController();
    let t = 1000;
    expect(ctrl.update(52, 21, 0, t)).toBe(false);
    t += 1500;
    expect(ctrl.update(52, 21, 0, t)).toBe(false);
    t += 1600;
    expect(ctrl.update(52, 21, 0, t)).toBe(true);
    expect(ctrl.isSleeping()).toBe(true);
  });

  it('wakes on movement over 6 m', () => {
    const ctrl = new MicroSleepController();
    let t = 0;
    ctrl.update(52, 21, 0, t);
    t += 3100;
    expect(ctrl.update(52, 21, 0, t)).toBe(true);
    expect(ctrl.update(52.00006, 21, 0, t + 100)).toBe(false);
    expect(ctrl.isSleeping()).toBe(false);
  });

  it('wakes on speed over 5 km/h', () => {
    const ctrl = new MicroSleepController();
    let t = 0;
    ctrl.update(52, 21, 0, t);
    t += 3100;
    expect(ctrl.update(52, 21, 0, t)).toBe(true);
    expect(ctrl.update(52, 21, 6, t + 50)).toBe(false);
  });
});
