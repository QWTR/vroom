import React, { memo, useMemo } from 'react';
import Mapbox from '@rnmapbox/maps';
import Animated, { useAnimatedProps } from 'react-native-reanimated';
import type { DriveMarkerValues } from '../../hooks/useDriveMarker';

/**
 * Mapbox RN wymaga shape jako JSON STRING (nie obiekt) — inaczej ClassCastException.
 * Preferuj SmoothDrPositionMarker + driveMarker SV w map.tsx (stabilniejsze).
 */
const AnimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);

type Props = {
  enabled: boolean;
  marker: DriveMarkerValues;
  iconImage?: string;
};

export const DriveMarkerLayer = memo(function DriveMarkerLayer({
  enabled,
  marker,
  iconImage = 'marker-15',
}: Props) {
  const animatedProps = useAnimatedProps(() => {
    'worklet';
    const la = marker.lat.value;
    const ln = marker.lng.value;
    const h = Number.isFinite(marker.heading.value) ? marker.heading.value : 0;
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      return {
        shape:
          '{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{"heading":0}}',
      };
    }
    return {
      shape: `{"type":"Feature","geometry":{"type":"Point","coordinates":[${ln},${la}]},"properties":{"heading":${h}}}`,
    };
  });

  const layerStyle = useMemo(
    () => ({
      iconImage,
      iconSize: 0.55,
      iconAllowOverlap: true,
      iconIgnorePlacement: true,
      iconRotate: ['get', 'heading'],
      iconRotationAlignment: 'map' as const,
      iconAnchor: 'center' as const,
    }),
    [iconImage],
  );

  if (!enabled) return null;

  return (
    <AnimatedShapeSource id="drive-core-vehicle" animatedProps={animatedProps}>
      <Mapbox.SymbolLayer id="drive-core-vehicle-symbol" style={layerStyle} />
    </AnimatedShapeSource>
  );
});
