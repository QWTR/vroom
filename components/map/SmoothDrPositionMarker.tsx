import React, { memo, useEffect, useState } from 'react';
import { DrPositionMarker, type DrPositionMarkerProps } from './DrPositionMarker';
import { useSmoothMapPosition } from '../../hooks/useSmoothMapPosition';

type Props = DrPositionMarkerProps & {
  enabled: boolean;
};

/**
 * Ten sam marker co w browse (DrPositionMarker + ViewShot), ale pozycja z Reanimated
 * — bez LocationPuck, który na Androidzie renderuje custom PNG jako gigantyczną płaszczyznę 3D.
 */
function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);
}

export const SmoothDrPositionMarker = memo(function SmoothDrPositionMarker({
  enabled,
  latitude: _lat,
  longitude: _lng,
  heading: _hdg,
  ...markerProps
}: Props) {
  const { lat, lng, heading } = useSmoothMapPosition(enabled);
  const [pose, setPose] = useState({ lat: _lat, lng: _lng, hdg: _hdg });

  useEffect(() => {
    if (!enabled) {
      setPose({ lat: _lat, lng: _lng, hdg: _hdg });
      return;
    }
    let rafId = 0;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      const slat = lat.value;
      const slng = lng.value;
      if (isValidCoord(slat, slng)) {
        setPose({ lat: slat, lng: slng, hdg: heading.value });
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
  }, [enabled, lat, lng, heading, _lat, _lng, _hdg]);

  if (!enabled) return null;

  const smoothOk = isValidCoord(pose.lat, pose.lng);
  const propsOk = isValidCoord(_lat, _lng);
  const displayLat = smoothOk ? pose.lat : (propsOk ? _lat : NaN);
  const displayLng = smoothOk ? pose.lng : (propsOk ? _lng : NaN);
  const displayHdg = smoothOk ? pose.hdg : _hdg;

  if (!Number.isFinite(displayLat) || !Number.isFinite(displayLng)) return null;

  return (
    <DrPositionMarker
      latitude={displayLat}
      longitude={displayLng}
      heading={displayHdg}
      {...markerProps}
    />
  );
});
