import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Mapbox from '@rnmapbox/maps';
import {
  EMPTY_VIEWPORT,
  normalizeViewportBounds,
  type ViewportBounds,
} from '../../hooks/liveFleetSpatialIndex';
import { useLiveMapUserIds, type LiveMapStore } from '../../hooks/liveMapStore';
import { useLiveFleetAnimator } from '../../hooks/useLiveFleetAnimator';
import { MAP_LIVE_MIN_ZOOM } from '../../lib/mapViewport';
import { LiveUsersFleetLayer } from './LiveUsersFleetLayer';

type Props = {
  store: LiveMapStore;
  enabled: boolean;
  anchor: { latitude: number; longitude: number } | null;
  selfUserId: number | string | null;
  mapRef: React.RefObject<Mapbox.MapView | null>;
  mapIdleNonce: number;
  zoom?: number;
  onUserPress: (userId: number) => void;
};

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
}: Props) {
  const liveUserIds = useLiveMapUserIds(store);
  const lastValidBoundsRef = useRef<ViewportBounds>(EMPTY_VIEWPORT);
  const lastViewportKeyRef = useRef('');
  const viewportQueryInFlightRef = useRef(false);
  const viewportQueryQueuedRef = useRef(false);
  const [viewportBounds, setViewportBounds] = useState<ViewportBounds>(EMPTY_VIEWPORT);
  const [viewportZoom, setViewportZoom] = useState(0);

  const fleetUserIds = useMemo(
    () => liveUserIds.filter((id) => String(id) !== String(selfUserId)),
    [liveUserIds, selfUserId],
  );

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
        const bounds = await map.getVisibleBounds();
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
          const zoom = await getZoom.call(map).catch(() => NaN);
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

  const viewportReady = viewportBounds.valid === 1;
  const effectiveZoom = Number.isFinite(zoom) ? Number(zoom) : viewportZoom;
  const renderEnabled = enabled && viewportReady && effectiveZoom >= MAP_LIVE_MIN_ZOOM;
  const animator = useLiveFleetAnimator(
    store,
    fleetUserIds,
    renderEnabled,
    anchor,
    viewportBounds,
    effectiveZoom,
  );

  return (
    <>
      {/* ShapeSource zostaje zamontowany także dla chwilowo pustej klatki.
          Remount przy każdym 0 -> 1 powodował widoczne mruganie ikon w Mapbox. */}
      <LiveUsersFleetLayer
        hotAnimatedShapeProps={animator.hotAnimatedShapeProps}
        coldAnimatedShapeProps={animator.coldAnimatedShapeProps}
        metaPinRequests={animator.metaPinRequests}
        visible={renderEnabled}
        onUserPress={onUserPress}
      />
    </>
  );
});
