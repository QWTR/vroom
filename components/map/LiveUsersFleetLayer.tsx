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
import { MAP_LIVE_MIN_ZOOM } from '../../lib/mapViewport';
import { LiveUserPinSpriteCapture } from './LiveUserPinSpriteCapture';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);
const ICON_SIZE = ['interpolate', ['linear'], ['zoom'], 11.5, 0.74, 15.5, 0.86, 18, 0.92] as any;

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
  symbolSortKey: 10,
};

function LiveUsersFleetLayerInner({ hotAnimatedShapeProps, coldAnimatedShapeProps, metaPinRequests, visible, onUserPress }: Props) {
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
      <ReanimatedShapeSource id="liveFleetHotSource" animatedProps={hotAnimatedShapeProps as never} onPress={handlePress} hitbox={{ width: 136, height: 60 }}>
        <Mapbox.SymbolLayer id="liveFleetHotPins" minZoomLevel={MAP_LIVE_MIN_ZOOM} style={pinStyle as any} />
      </ReanimatedShapeSource>
      <ReanimatedShapeSource id="liveFleetColdSource" animatedProps={coldAnimatedShapeProps as never} onPress={handlePress} hitbox={{ width: 136, height: 60 }}>
        <Mapbox.SymbolLayer id="liveFleetColdPins" minZoomLevel={MAP_LIVE_MIN_ZOOM} style={pinStyle as any} />
      </ReanimatedShapeSource>
    </>
  );
}

export const LiveUsersFleetLayer = memo(LiveUsersFleetLayerInner);
