import React, { memo, useMemo } from 'react';
import type { LiveMapStore } from '../../hooks/liveMapStore';
import { LiveUserMapMarker } from './LiveUserMapMarker';

type Props = {
  store: LiveMapStore;
  userIds: number[];
  visible: boolean;
  zoom: number;
  onUserPress: (userId: number) => void;
};

function markerPriority(store: LiveMapStore, id: number): number {
  const meta = store.getMeta(id);
  if (meta?.isPremium) return 30;
  if (meta?.isFriend) return 20;
  return 10;
}

function LiveUsersFleetLayerInner({
  store,
  userIds,
  visible,
  zoom,
  onUserPress,
}: Props) {
  const orderedIds = useMemo(
    () => [...userIds].sort((a, b) => markerPriority(store, a) - markerPriority(store, b)),
    [store, userIds],
  );

  if (!visible) return null;

  return (
    <>
      {orderedIds.map((userId) => (
        <LiveUserMapMarker
          key={userId}
          store={store}
          userId={userId}
          zoom={zoom}
          onPress={onUserPress}
        />
      ))}
    </>
  );
}

export const LiveUsersFleetLayer = memo(LiveUsersFleetLayerInner);
