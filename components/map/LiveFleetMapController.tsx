import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Mapbox from '@rnmapbox/maps';
import {
  EMPTY_VIEWPORT,
  normalizeViewportBounds,
  type ViewportBounds,
} from '../../hooks/liveFleetSpatialIndex';
import { useLiveMapUserIds, type LiveMapStore } from '../../hooks/liveMapStore';
import { useLiveFleetAnimator } from '../../hooks/useLiveFleetAnimator';
import { LiveUsersFleetLayer } from './LiveUsersFleetLayer';
import { FleetVehicleModelsLayer } from './FleetVehicleModelsLayer';

const VIEWPORT_REFRESH_MS = 250;

type Props = {
  store: LiveMapStore;
  enabled: boolean;
  anchor: { latitude: number; longitude: number } | null;
  selfUserId: number | string | null;
  mapRef: React.RefObject<Mapbox.MapView | null>;
  mapIdleNonce: number;
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
  onUserPress,
}: Props) {
  const liveUserIds = useLiveMapUserIds(store);
  const lastValidBoundsRef = useRef<ViewportBounds>(EMPTY_VIEWPORT);
  const lastViewportKeyRef = useRef('');
  const lastViewportRefreshAtRef = useRef(0);
  const viewportQueryInFlightRef = useRef(false);
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

  const refreshViewportFromNative = useCallback(async (force = false) => {
    const map = mapRef.current;
    if (!map || !enabled) return;
    const now = Date.now();
    if (!force && now - lastViewportRefreshAtRef.current < VIEWPORT_REFRESH_MS) return;
    if (viewportQueryInFlightRef.current) return;
    lastViewportRefreshAtRef.current = now;
    viewportQueryInFlightRef.current = true;
    try {
      const bounds = await map.getVisibleBounds();
      const topRight = bounds?.[0];
      const bottomLeft = bounds?.[1];
      if (!Array.isArray(topRight) || !Array.isArray(bottomLeft)) return;
      const east = Number(topRight[0]);
      const north = Number(topRight[1]);
      const west = Number(bottomLeft[0]);
      const south = Number(bottomLeft[1]);
      if (
        !Number.isFinite(north)
        || !Number.isFinite(south)
        || !Number.isFinite(east)
        || !Number.isFinite(west)
      ) {
        return;
      }
      const getZoom = (map as unknown as { getZoom?: () => Promise<number> }).getZoom;
      if (typeof getZoom === 'function') {
        const zoom = await getZoom.call(map).catch(() => NaN);
        if (Number.isFinite(zoom)) setViewportZoom(zoom);
      }
      commitViewport(normalizeViewportBounds({
        north,
        south,
        east,
        west,
        valid: 1,
      }));
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
    void refreshViewportFromNative(true);
  }, [enabled, refreshViewportFromNative]);

  useEffect(() => {
    if (!enabled || mapIdleNonce <= 0) return;
    void refreshViewportFromNative(true);
  }, [enabled, mapIdleNonce, refreshViewportFromNative]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      void refreshViewportFromNative(false);
    }, VIEWPORT_REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, refreshViewportFromNative]);

  const viewportReady = viewportBounds.valid === 1;
  const animator = useLiveFleetAnimator(
    store,
    fleetUserIds,
    enabled && viewportReady,
    anchor,
    viewportBounds,
    viewportZoom,
  );

  return (
    <>
      <FleetVehicleModelsLayer
        animatedShapeProps={animator.vehicleAnimatedShapeProps}
        visible={enabled && viewportReady}
        minZoomLevel={0}
      />
      <LiveUsersFleetLayer
        animatedShapeProps={animator.animatedShapeProps}
        metaPinRequests={animator.metaPinRequests}
        visible={enabled && viewportReady && animator.hasFleet}
        onUserPress={onUserPress}
      />
    </>
  );
});
