import React, { memo, useCallback } from 'react';
import { View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import Animated from 'react-native-reanimated';
import type { FleetMetaPinRequest } from '../../hooks/useLiveFleetAnimator';
import {
  LIVE_USER_PIN_SPRITE_H,
  LIVE_USER_PIN_SPRITE_W,
  liveUserPinImageKey,
  useLiveUserPinSprites,
} from '../../hooks/useLiveUserPinSprites';
import { LiveUserPinSpriteCapture } from './LiveUserPinSpriteCapture';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);
const ICON_SIZE = [
  'interpolate', ['linear'], ['zoom'],
  0, 0.72,
  5, 0.78,
  11.5, 0.88,
  15.5, 0.98,
  18, 1.04,
] as any;

type Props = {
  hotAnimatedShapeProps: { shape?: string };
  coldAnimatedShapeProps: { shape?: string };
  metaPinRequests: FleetMetaPinRequest[];
  visible: boolean;
  onUserPress: (userId: number) => void;
};

const pinStyle = {
  iconImage: ['concat', 'avatar_', ['to-string', ['get', 'id']]],
  iconSize: ICON_SIZE,
  iconAllowOverlap: true,
  iconIgnorePlacement: true,
  iconAnchor: 'center' as const,
  iconOptional: true,
  iconPitchAlignment: 'viewport' as const,
  iconRotationAlignment: 'viewport' as const,
  symbolSortKey: ['coalesce', ['get', 'markerPriority'], 10] as any,
};

function LiveUsersFleetLayerInner({ hotAnimatedShapeProps, coldAnimatedShapeProps, metaPinRequests, visible, onUserPress }: Props) {
  // Tożsamość użytkownika jest przygotowywana niezależnie od zoomu. Dzięki temu
  // Mapbox nigdy nie przełącza kropki na opóźniony sprite po zakończeniu gestu.
  const { images, pendingCaptures, handleCapture } = useLiveUserPinSprites(metaPinRequests);
  const handlePress = useCallback((event: any) => {
    const userId = Number(event.features?.[0]?.properties?.id);
    if (Number.isFinite(userId)) onUserPress(userId);
  }, [onUserPress]);

  if (!visible) return null;
  return (
    <>
      <View pointerEvents="none" style={{ position: 'absolute', left: -10_000, top: -10_000, width: LIVE_USER_PIN_SPRITE_W, height: LIVE_USER_PIN_SPRITE_H, opacity: 1 }}>
        {pendingCaptures.map((request) => (
          <LiveUserPinSpriteCapture key={request.signature} imageKey={liveUserPinImageKey(request.id)} signature={request.signature} data={request.data} onCapture={handleCapture} />
        ))}
      </View>
      {Object.keys(images).length > 0 ? <Mapbox.Images images={images} /> : null}
      <ReanimatedShapeSource id="liveFleetHotSource" animatedProps={hotAnimatedShapeProps as never} onPress={handlePress} hitbox={{ width: 160, height: 64 }}>
        <Mapbox.SymbolLayer id="liveFleetHotPins" style={pinStyle as any} />
      </ReanimatedShapeSource>
      <ReanimatedShapeSource id="liveFleetColdSource" animatedProps={coldAnimatedShapeProps as never} onPress={handlePress} hitbox={{ width: 160, height: 64 }}>
        <Mapbox.SymbolLayer id="liveFleetColdPins" style={pinStyle as any} />
      </ReanimatedShapeSource>
    </>
  );
}

export const LiveUsersFleetLayer = memo(LiveUsersFleetLayerInner);
