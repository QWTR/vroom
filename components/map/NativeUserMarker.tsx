import React, { memo, useMemo, useState, useEffect } from 'react';
import Mapbox from '@rnmapbox/maps';
import { useSmoothMapPosition } from '../../hooks/useSmoothMapPosition';
import { normalizeMediaUri } from '../../lib/mediaUri';

const PUCK_BEARING = 'user-puck-bearing';
const PUCK_TOP = 'user-puck-top';

/** LocationPuck wymaga małych obrazów (HTTP). ViewShot → file:// na Androidzie często łapie cały ekran (splash/logo) i renderuje jako gigantyczną płaszczyznę 3D przy pitch ~68°. */
function safePuckImageUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const trimmed = uri.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export type NativeUserMarkerProps = {
  enabled: boolean;
  /** Zdalny avatar (HTTP) — jedyny dozwolony custom puck. */
  avatarUrl?: string | null;
  useArrowStyle?: boolean;
};

/**
 * Native LocationPuck — position updates isolated to this component (rAF reads Reanimated shared values).
 * Avoids Animated.createAnimatedComponent on CustomLocationProvider (unstable on Fabric).
 */
export const NativeUserMarker = memo(function NativeUserMarker({
  enabled,
  avatarUrl,
  useArrowStyle,
}: NativeUserMarkerProps) {
  const { lat, lng, heading } = useSmoothMapPosition(enabled);

  const images = useMemo(() => {
    if (useArrowStyle) return {};
    const uri = safePuckImageUri(normalizeMediaUri(avatarUrl));
    if (!uri) return {};
    return {
      [PUCK_BEARING]: { uri },
      [PUCK_TOP]: { uri },
    };
  }, [avatarUrl, useArrowStyle]);

  const hasImages = Object.keys(images).length > 0;

  const [pose, setPose] = useState({ lat: 0, lng: 0, heading: 0 });

  useEffect(() => {
    if (!enabled) return;
    let rafId = 0;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      setPose({
        lat: lat.value,
        lng: lng.value,
        heading: heading.value,
      });
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
  }, [enabled, lat, lng, heading]);

  if (!enabled) return null;
  if (!Number.isFinite(pose.lat) || !Number.isFinite(pose.lng)) return null;
  if (Math.abs(pose.lat) < 1e-6 && Math.abs(pose.lng) < 1e-6) return null;

  return (
    <>
      {hasImages ? <Mapbox.Images images={images} /> : null}
      <Mapbox.CustomLocationProvider
        coordinate={[pose.lng, pose.lat]}
        heading={pose.heading}
      />
      <Mapbox.LocationPuck
        visible
        puckBearingEnabled
        puckBearing="course"
        bearingImage={hasImages ? PUCK_BEARING : undefined}
        topImage={!useArrowStyle && avatarUrl ? PUCK_TOP : undefined}
        pulsing={{ isEnabled: false }}
        scale={1.05}
      />
    </>
  );
});
