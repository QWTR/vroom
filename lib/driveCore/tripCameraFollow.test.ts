import { describe, expect, it } from 'vitest';
import {
  cameraFrameFromDisplayedMarker,
  nativeFollowerFrameFromMarker,
  tripCameraSegmentDurationMs,
} from './tripCameraFollow';

describe('trip camera follow', () => {
  it('uses the exact displayed marker pose rather than a delayed GPS target', () => {
    const marker = { lat: 52.229734, lng: 21.012229, heading: 91.5 };

    expect(cameraFrameFromDisplayedMarker(marker)).toEqual(marker);
  });

  it('rejects an uninitialized marker pose', () => {
    expect(cameraFrameFromDisplayedMarker({ lat: 0, lng: 0, heading: 0 })).toBeNull();
  });

  it('keeps the camera on the marker segment duration', () => {
    expect(tripCameraSegmentDurationMs(250)).toBe(250);
    expect(tripCameraSegmentDurationMs(20)).toBe(200);
    expect(tripCameraSegmentDurationMs(9_000)).toBe(2_000);
  });

  it('creates native motion props directly from the displayed marker', () => {
    expect(nativeFollowerFrameFromMarker({ lat: 52.23, lng: 21.01, heading: -90 }, 20, 220)).toEqual({
      positionValid: 1,
      latitude: 52.23,
      longitude: 21.01,
      heading: 270,
      segmentDurationMs: 220,
    });
  });

  it('defaults segment duration when omitted', () => {
    expect(nativeFollowerFrameFromMarker({ lat: 52.23, lng: 21.01, heading: 10 }, 0).segmentDurationMs).toBe(1_000);
  });

  it('keeps invalid positions out of native prop updates', () => {
    expect(nativeFollowerFrameFromMarker({ lat: 0, lng: 0, heading: 0 }, 0).positionValid).toBe(0);
  });
});
