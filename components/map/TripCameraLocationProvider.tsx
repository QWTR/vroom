import React, { memo, useCallback, useEffect, useState } from 'react';
import Mapbox from '@rnmapbox/maps';
import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import type { DriveMarkerV3Values } from '../../hooks/useDriveMarkerV3';

const PROVIDER_FRAME_MS = 33;

type Pose = {
  lat: number;
  lng: number;
  heading: number;
};

type Props = {
  enabled: boolean;
  marker: DriveMarkerV3Values;
};

/**
 * Lekki most do natywnego FollowPuck. Przekazuje aktualnie renderowaną pozycję
 * markera, a nie kolejne surowe fixy GPS. Sam ruch kamery wykonuje Mapbox.
 */
export const TripCameraLocationProvider = memo(function TripCameraLocationProvider({
  enabled,
  marker,
}: Props) {
  const [pose, setPose] = useState<Pose | null>(null);
  const enabledSv = useSharedValue(enabled ? 1 : 0);
  const lastPushMs = useSharedValue(0);

  useEffect(() => {
    enabledSv.value = enabled ? 1 : 0;
  }, [enabled, enabledSv]);

  const commitPose = useCallback((lat: number, lng: number, heading: number) => {
    setPose({ lat, lng, heading });
  }, []);

  useAnimatedReaction(
    () => ({
      lat: marker.lat.value,
      lng: marker.lng.value,
      heading: marker.heading.value,
      enabled: enabledSv.value,
    }),
    (next) => {
      if (next.enabled < 0.5) return;
      if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;
      if (Math.abs(next.lat) < 1e-6 && Math.abs(next.lng) < 1e-6) return;

      const now = Date.now();
      if (now - lastPushMs.value < PROVIDER_FRAME_MS) return;
      lastPushMs.value = now;
      runOnJS(commitPose)(
        next.lat,
        next.lng,
        Number.isFinite(next.heading) ? next.heading : 0,
      );
    },
    [commitPose, enabledSv, lastPushMs, marker.heading, marker.lat, marker.lng],
  );

  if (!enabled || !pose) return null;

  return (
    <Mapbox.CustomLocationProvider
      coordinate={[pose.lng, pose.lat]}
      heading={pose.heading}
    />
  );
});
