import React, { memo, useCallback } from 'react';
import { View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import Animated from 'react-native-reanimated';
import type { FleetMetaPinRequest } from '../../hooks/useLiveFleetAnimator';
import { liveUserPinImageKey, useLiveUserPinSprites } from '../../hooks/useLiveUserPinSprites';
import { MAP_LIVE_LABEL_MIN_ZOOM, MAP_LIVE_MIN_ZOOM } from '../../lib/mapViewport';
import { LiveUserPinSpriteCapture } from './LiveUserPinSpriteCapture';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);
const ICON_SIZE = ['interpolate', ['linear'], ['zoom'], 11.5, 0.72, 15.5, 0.84, 18, 0.9] as any;

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

const nameStyle = {
  textField: ['get', 'username'],
  textSize: 11,
  textColor: '#ffffff',
  textHaloColor: 'rgba(5,8,12,0.95)',
  textHaloWidth: 2,
  textOffset: [0, 2.25],
  textAnchor: 'top' as const,
  textAllowOverlap: false,
  textIgnorePlacement: false,
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
      <View pointerEvents="none" style={{ position: 'absolute', left: -10_000, top: -10_000, width: 80, height: 80, opacity: 1 }}>
        {pendingCaptures.map((request) => (
          <LiveUserPinSpriteCapture key={request.signature} imageKey={liveUserPinImageKey(request.id)} signature={request.signature} data={request.data} onCapture={handleCapture} />
        ))}
      </View>
      {Object.keys(images).length > 0 ? <Mapbox.Images images={images} /> : null}
      <ReanimatedShapeSource id="liveFleetHotSource" animatedProps={hotAnimatedShapeProps as never} onPress={handlePress} hitbox={{ width: 52, height: 52 }}>
        <Mapbox.CircleLayer id="liveFleetHotHalo" minZoomLevel={MAP_LIVE_MIN_ZOOM} style={{ circleRadius: 24, circleColor: 'rgba(5,8,12,0.82)', circleStrokeColor: ['coalesce', ['get', 'pinColor'], '#25c7ff'] as any, circleStrokeWidth: 2.5, circlePitchAlignment: 'viewport' }} />
        <Mapbox.CircleLayer id="liveFleetHotFallback" minZoomLevel={MAP_LIVE_MIN_ZOOM} style={{ circleRadius: 8, circleColor: ['coalesce', ['get', 'pinColor'], '#25c7ff'] as any, circleStrokeColor: '#ffffff', circleStrokeWidth: 2, circlePitchAlignment: 'viewport' }} />
        <Mapbox.SymbolLayer id="liveFleetHotPins" minZoomLevel={MAP_LIVE_MIN_ZOOM} style={pinStyle as any} />
        <Mapbox.SymbolLayer id="liveFleetHotNames" minZoomLevel={MAP_LIVE_LABEL_MIN_ZOOM} style={nameStyle as any} />
      </ReanimatedShapeSource>
      <ReanimatedShapeSource id="liveFleetColdSource" animatedProps={coldAnimatedShapeProps as never} onPress={handlePress} hitbox={{ width: 52, height: 52 }}>
        <Mapbox.CircleLayer id="liveFleetColdHalo" minZoomLevel={MAP_LIVE_MIN_ZOOM} style={{ circleRadius: 24, circleColor: 'rgba(5,8,12,0.82)', circleStrokeColor: ['coalesce', ['get', 'pinColor'], '#7b818b'] as any, circleStrokeWidth: 2.5, circlePitchAlignment: 'viewport' }} />
        <Mapbox.CircleLayer id="liveFleetColdFallback" minZoomLevel={MAP_LIVE_MIN_ZOOM} style={{ circleRadius: 8, circleColor: ['coalesce', ['get', 'pinColor'], '#7b818b'] as any, circleStrokeColor: '#ffffff', circleStrokeWidth: 2, circlePitchAlignment: 'viewport' }} />
        <Mapbox.SymbolLayer id="liveFleetColdPins" minZoomLevel={MAP_LIVE_MIN_ZOOM} style={pinStyle as any} />
        <Mapbox.SymbolLayer id="liveFleetColdNames" minZoomLevel={MAP_LIVE_LABEL_MIN_ZOOM} style={nameStyle as any} />
      </ReanimatedShapeSource>
    </>
  );
}

export const LiveUsersFleetLayer = memo(LiveUsersFleetLayerInner);
