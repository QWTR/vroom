import React, { memo, useCallback, useMemo } from 'react';
import { View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import type { LiveFleetGeoJson } from '../../hooks/useLiveFleetAnimator';
import {
  buildPinSpriteSignature,
  liveUserPinIconSize,
  liveUserPinImageKey,
  useLiveUserPinSprites,
} from '../../hooks/useLiveUserPinSprites';
import { LiveUserPinSpriteCapture } from './LiveUserPinSpriteCapture';

type Props = {
  shape: LiveFleetGeoJson;
  visible: boolean;
  onUserPress: (userId: number) => void;
};

function LiveUsersFleetLayerInner({ shape, visible, onUserPress }: Props) {
  const pinRequests = useMemo(
    () => shape.features.map((f) => {
      const p = f.properties;
      return {
        id: p.id,
        signature: buildPinSpriteSignature({
          id: p.id,
          avatarUrl: p.avatarUrl,
          avatarFrameUrl: p.avatarFrameUrl,
          isPremium: p.isPremium === 1,
          isFriend: p.isFriend === 1,
          initials: p.initials,
          distanceLabel: p.distanceLabel,
        }),
        data: {
          username: p.username,
          initials: p.initials,
          distanceLabel: p.distanceLabel,
          avatarUrl: p.hasAvatar === 1 ? p.avatarUrl : null,
          avatarFrameUrl: p.avatarFrameUrl || null,
          isPremium: p.isPremium === 1,
          isFriend: p.isFriend === 1,
        },
      };
    }),
    [shape.features],
  );

  const { images, pendingCaptures, handleCapture } = useLiveUserPinSprites(pinRequests);
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

  if (!visible || !shape.features.length) return null;

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

      <Mapbox.ShapeSource
        id="liveUsersSource"
        shape={shape}
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
          }}
        />
      </Mapbox.ShapeSource>
    </>
  );
}

export const LiveUsersFleetLayer = memo(LiveUsersFleetLayerInner);
