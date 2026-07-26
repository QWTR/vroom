import { describe, expect, it } from 'vitest';
import {
  buildLiveVehicleIdentityProperties,
  LIVE_VEHICLE_NAME_STYLE,
} from './liveVehicleLabel';

describe('live vehicle identity label', () => {
  it('always carries the driver id and username', () => {
    expect(buildLiveVehicleIdentityProperties(7, ' Kierowca ', '#fff')).toEqual({
      id: 7,
      username: 'Kierowca',
      pinColor: '#fff',
    });
  });

  it('stays visible through symbol collisions and faces the viewport', () => {
    expect(LIVE_VEHICLE_NAME_STYLE.textAllowOverlap).toBe(true);
    expect(LIVE_VEHICLE_NAME_STYLE.textIgnorePlacement).toBe(true);
    expect(LIVE_VEHICLE_NAME_STYLE.textPitchAlignment).toBe('viewport');
  });
});
