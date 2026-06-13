import React, { memo, useCallback } from 'react';
import { View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import Animated from 'react-native-reanimated';
import type { FleetMetaPinRequest } from '../../hooks/useLiveFleetAnimator';
import {
  liveUserPinIconSize,
  liveUserPinImageKey,
  useLiveUserPinSprites,
} from '../../hooks/useLiveUserPinSprites';
import { LiveUserPinSpriteCapture } from './LiveUserPinSpriteCapture';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);

type Props = {
  animatedShapeProps: Partial<{ shape: string }>;
  metaPinRequests: FleetMetaPinRequest[];
  visible: boolean;
  onUserPress: (userId: number) => void;
};

function LiveUsersFleetLayerInner({
  animatedShapeProps,
  metaPinRequests,
  visible,
  onUserPress,
}: Props) {
  const { images, pendingCaptures, handleCapture } = useLiveUserPinSprites(metaPinRequests);
  const hasPinImages = Object.keys(images).length > 0;
  const iconSize = liveUserPinIconSize();

  const handlePress = useCallback(
    (e: { features?: Array<{ properties?: { id?: number | string } }> }) => {
      const rawId = e.features?.[0]?.properties?.id;
      const userId = Number(rawId);
      if (!Number.isFinite(userId)) return;
      onUserPress(userId);
    },
    [onUserPress],
  );

  if (!visible || metaPinRequests.length === 0) return null;

  return (
    <>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, overflow: 'hidden' }}
      >
        {pendingCaptures.map((req) => (
          <LiveUserPinSpriteCapture
            key={req.signature}
            imageKey={liveUserPinImageKey(req.id)}
            data={req.data}
            onCapture={handleCapture}
          />
        ))}
      </View>

      {hasPinImages ? <Mapbox.Images images={images} /> : null}

      <ReanimatedShapeSource
        id="liveUsersSource"
        animatedProps={animatedShapeProps}
        onPress={handlePress}
        hitbox={{ width: 140, height: 100 }}
      >
        <Mapbox.SymbolLayer
          id="liveUsersPins"
          style={{
            iconImage: ['concat', 'avatar_', ['to-string', ['get', 'id']]],
            iconSize,
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconAnchor: 'bottom',
            iconOptional: true,
            iconPitchAlignment: 'map',
            iconRotationAlignment: 'map',
          }}
        />
      </ReanimatedShapeSource>
    </>
  );
}

export const LiveUsersFleetLayer = memo(LiveUsersFleetLayerInner);
