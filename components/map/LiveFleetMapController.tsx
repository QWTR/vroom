import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Mapbox from '@rnmapbox/maps';
import {
  EMPTY_VIEWPORT,
  expandBoundsByMeters,
  isInViewport,
  normalizeViewportBounds,
  type ViewportBounds,
} from '../../hooks/liveFleetSpatialIndex';
import { useLiveMapUserIds, type LiveMapStore } from '../../hooks/liveMapStore';
import { LiveUsersFleetLayer } from './LiveUsersFleetLayer';
import type { ConvoyParticipant } from '../../lib/convoyLive';
import { mergeLiveAndConvoyUserIds } from '../../lib/convoyUi';

type Props = {
  store: LiveMapStore;
  enabled: boolean;
  anchor: { latitude: number; longitude: number } | null;
  selfUserId: number | string | null;
  mapRef: React.RefObject<Mapbox.MapView | null>;
  mapIdleNonce: number;
  zoom?: number;
  onUserPress: (userId: number) => void;
  convoyParticipants?: ConvoyParticipant[];
  convoyHostId?: number | null;
};

// getVisibleBounds() can fail while a Mapbox style is being attached or
// recreated. LIVE data is already privacy-filtered by the server, so a short
// full-world fallback is safer than dropping every received user from the
// renderer until the next map-idle event happens to succeed.
const LIVE_FLEET_FALLBACK_VIEWPORT: ViewportBounds = {
  north: 90,
  south: -90,
  east: 180,
  west: -180,
  valid: 1,
};
const MAP_VIEWPORT_QUERY_TIMEOUT_MS = 1_500;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('map viewport query timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function viewportKey(bounds: ViewportBounds): string {
  if (bounds.valid !== 1) return 'invalid';
  return [
    bounds.north.toFixed(5),
    bounds.south.toFixed(5),
    bounds.east.toFixed(5),
    bounds.west.toFixed(5),
  ].join(':');
}

export const LiveFleetMapController = memo(function LiveFleetMapController({
  store,
  enabled,
  anchor,
  selfUserId,
  mapRef,
  mapIdleNonce,
  zoom,
  onUserPress,
  convoyParticipants = [],
  convoyHostId,
}: Props) {
  const liveUserIds = useLiveMapUserIds(store);
  const lastValidBoundsRef = useRef<ViewportBounds>(EMPTY_VIEWPORT);
  const lastViewportKeyRef = useRef('');
  const viewportQueryInFlightRef = useRef(false);
  const viewportQueryQueuedRef = useRef(false);
  const visibleMarkerIdsRef = useRef<number[]>([]);
  const [viewportBounds, setViewportBounds] = useState<ViewportBounds>(EMPTY_VIEWPORT);
  const [viewportZoom, setViewportZoom] = useState(0);
  const [positionRevision, setPositionRevision] = useState(0);

  const convoyByUserId = useMemo(
    () => new Map(convoyParticipants.map((participant) => [participant.userId, participant])),
    [convoyParticipants],
  );
  const fleetUserIds = useMemo(() => {
    return mergeLiveAndConvoyUserIds(liveUserIds, convoyParticipants, selfUserId);
  }, [convoyParticipants, liveUserIds, selfUserId]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = store.subscribeFleetDeltas(() => setPositionRevision((revision) => revision + 1));
    return () => {
      unsubscribe();
    };
  }, [enabled, store]);

  const commitViewport = useCallback((next: ViewportBounds) => {
    if (next.valid !== 1) return;
    const key = viewportKey(next);
    if (key === lastViewportKeyRef.current) return;
    lastViewportKeyRef.current = key;
    lastValidBoundsRef.current = next;
    setViewportBounds(next);
  }, []);

  const refreshViewportFromNative = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !enabled) return;
    if (viewportQueryInFlightRef.current) {
      viewportQueryQueuedRef.current = true;
      return;
    }
    viewportQueryInFlightRef.current = true;
    try {
      do {
        viewportQueryQueuedRef.current = false;
        const bounds = await withTimeout(map.getVisibleBounds(), MAP_VIEWPORT_QUERY_TIMEOUT_MS);
        const topRight = bounds?.[0];
        const bottomLeft = bounds?.[1];
        if (Array.isArray(topRight) && Array.isArray(bottomLeft)) {
          const east = Number(topRight[0]);
          const north = Number(topRight[1]);
          const west = Number(bottomLeft[0]);
          const south = Number(bottomLeft[1]);
          if (
            Number.isFinite(north)
            && Number.isFinite(south)
            && Number.isFinite(east)
            && Number.isFinite(west)
          ) {
            commitViewport(normalizeViewportBounds({
              north,
              south,
              east,
              west,
              valid: 1,
            }));
          }
        }
        const getZoom = (map as unknown as { getZoom?: () => Promise<number> }).getZoom;
        if (typeof getZoom === 'function') {
          const zoom = await withTimeout(
            getZoom.call(map),
            MAP_VIEWPORT_QUERY_TIMEOUT_MS,
          ).catch(() => NaN);
          if (Number.isFinite(zoom)) setViewportZoom(zoom);
        }
      } while (viewportQueryQueuedRef.current && enabled && mapRef.current === map);
    } catch {
      if (lastValidBoundsRef.current.valid === 1) {
        commitViewport(lastValidBoundsRef.current);
      }
    } finally {
      viewportQueryInFlightRef.current = false;
    }
  }, [mapRef, enabled, commitViewport]);

  useEffect(() => {
    if (!enabled) {
      lastViewportKeyRef.current = '';
      setViewportBounds(EMPTY_VIEWPORT);
      return;
    }
    void refreshViewportFromNative();
  }, [enabled, refreshViewportFromNative]);

  useEffect(() => {
    if (!enabled || mapIdleNonce <= 0) return;
    void refreshViewportFromNative();
  }, [enabled, mapIdleNonce, refreshViewportFromNative]);

  const movingAnchorKey = anchor
    && Number.isFinite(anchor.latitude)
    && Number.isFinite(anchor.longitude)
    ? `${anchor.latitude.toFixed(5)}:${anchor.longitude.toFixed(5)}`
    : 'invalid';

  // Kamera follow podczas jazdy praktycznie nigdy nie przechodzi w idle.
  // Odświeżaj więc natywne bounds razem z przesuwającym się anchorem mapy.
  useEffect(() => {
    if (!enabled || movingAnchorKey === 'invalid') return;
    void refreshViewportFromNative();
  }, [enabled, movingAnchorKey, refreshViewportFromNative]);

  const effectiveZoom = Number.isFinite(zoom) ? Number(zoom) : viewportZoom;
  const renderEnabled = enabled;
  const effectiveViewportBounds = useMemo(
    () => viewportBounds.valid === 1 ? viewportBounds : LIVE_FLEET_FALLBACK_VIEWPORT,
    [viewportBounds],
  );
  const markerViewportBounds = useMemo(
    () => expandBoundsByMeters(effectiveViewportBounds, 1_500),
    [effectiveViewportBounds],
  );
  const visibleMarkerIds = useMemo(
    () => {
      void positionRevision;
      const next = fleetUserIds.filter((id) => {
        const convoyPosition = convoyByUserId.get(id)?.position;
        const position = Number.isFinite(Number(convoyPosition?.lat)) && Number.isFinite(Number(convoyPosition?.lng))
          ? { lat: Number(convoyPosition?.lat), lng: Number(convoyPosition?.lng) }
          : store.getPosition(id);
        return !!position && isInViewport(position.lat, position.lng, markerViewportBounds);
      });
      const previous = visibleMarkerIdsRef.current;
      if (next.length === previous.length && next.every((id, index) => id === previous[index])) {
        return previous;
      }
      visibleMarkerIdsRef.current = next;
      return next;
    },
    // positionRevision is a batched 50 ms signal. The resulting ID list changes
    // only when a user enters or leaves the expanded viewport.
    [convoyByUserId, fleetUserIds, markerViewportBounds, positionRevision, store],
  );

  return (
    <LiveUsersFleetLayer
      store={store}
      userIds={visibleMarkerIds}
      visible={renderEnabled}
      zoom={effectiveZoom}
      onUserPress={onUserPress}
      convoyParticipants={convoyParticipants}
      convoyHostId={convoyHostId}
    />
  );
});
