import React, { memo, useMemo } from 'react';
import type { LiveMapStore } from '../../hooks/liveMapStore';
import type { ConvoyParticipant } from '../../lib/convoyLive';
import { LiveUserMapMarker } from './LiveUserMapMarker';

type Props = {
  store: LiveMapStore;
  userIds: number[];
  visible: boolean;
  zoom: number;
  onUserPress: (userId: number) => void;
  convoyParticipants?: ConvoyParticipant[];
  convoyHostId?: number | null;
};

function markerPriority(store: LiveMapStore, id: number, convoyIds: Set<number>): number {
  if (convoyIds.has(id)) return 40;
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
  convoyParticipants = [],
  convoyHostId,
}: Props) {
  const convoyByUserId = useMemo(
    () => new Map(convoyParticipants.map((participant) => [participant.userId, participant])),
    [convoyParticipants],
  );
  const convoyIds = useMemo(() => new Set(convoyByUserId.keys()), [convoyByUserId]);
  const orderedIds = useMemo(
    () => [...userIds].sort((a, b) => markerPriority(store, a, convoyIds) - markerPriority(store, b, convoyIds)),
    [convoyIds, store, userIds],
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
          convoyParticipant={convoyByUserId.get(userId)}
          convoyHostId={convoyHostId}
        />
      ))}
    </>
  );
}

export const LiveUsersFleetLayer = memo(LiveUsersFleetLayerInner);
