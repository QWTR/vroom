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
  animatedShapeProps: { shape?: string };
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
  const iconSize = liveUserPinIconSize();

  const handlePress = useCallback(
    (e: any) => {
      const rawId = e.features?.[0]?.properties?.id;
      const userId = Number(rawId);
      if (!Number.isFinite(userId)) return;
      onUserPress(userId);
    },
    [onUserPress],
  );

  if (!visible) return null;

  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -10_000,
          top: -10_000,
          width: 220,
          height: 220,
          opacity: 1,
          overflow: 'visible',
        }}
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

      {Object.keys(images).length > 0 ? (
        <>
          <Mapbox.Images images={images} />
          <ReanimatedShapeSource
            id="liveFleetSource"
            animatedProps={animatedShapeProps}
            onPress={handlePress}
            hitbox={{ width: 72, height: 72 }}
          >
            <Mapbox.SymbolLayer
              id="liveFleetPins"
              style={{
                iconImage: ['concat', 'avatar_', ['to-string', ['get', 'id']]],
                iconSize,
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
                iconAnchor: 'bottom',
                iconOptional: true,
                iconPitchAlignment: 'viewport',
                iconRotationAlignment: 'viewport',
              }}
            />
          </ReanimatedShapeSource>
        </>
      ) : null}
    </>
  );
}

export const LiveUsersFleetLayer = memo(LiveUsersFleetLayerInner);
