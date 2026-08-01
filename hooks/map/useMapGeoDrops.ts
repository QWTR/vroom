import type { MutableRefObject } from 'react';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { MAP_PERF } from '../../constants/mapPerformance';
import type { NavMode } from '../../lib/navigationV3/types';

export type UseMapGeoDropsParams = {
  navV3Mode: NavMode;
  dropNavigationTargetId: string | null;
  gamificationDropsLength: number;
  availableDropPrompt: unknown;
  userLat?: number;
  userLng?: number;
  lastTripMarkerPoseRef: MutableRefObject<{ lat: number; lng: number } | null>;
  drHdgRef: MutableRefObject<number>;
  lastHeadingRef: MutableRefObject<number>;
  speedKmhRef: MutableRefObject<number>;
  tryClaimGamificationDrop: (opts: {
    lat: number;
    lng: number;
    mode: NavMode;
    headingDeg: number | null;
    speedKmh: number;
  }) => Promise<void>;
  refreshGamificationDrops: (lat: number, lng: number, force?: boolean) => Promise<void>;
  syncGamificationDropStatus: (force?: boolean) => Promise<boolean>;
  pollGamificationRewards: (force?: boolean) => Promise<void>;
};

/** Geo-drop claim polling + drop list refresh while driving/navigating. */
export function useMapGeoDrops(params: UseMapGeoDropsParams) {
  const {
    navV3Mode,
    dropNavigationTargetId,
    gamificationDropsLength,
    availableDropPrompt,
    userLat,
    userLng,
    lastTripMarkerPoseRef,
    drHdgRef,
    lastHeadingRef,
    speedKmhRef,
    tryClaimGamificationDrop,
    refreshGamificationDrops,
    syncGamificationDropStatus,
    pollGamificationRewards,
  } = params;

  const tripMode = navV3Mode === 'freeDrive' || navV3Mode === 'navigation';

  useEffect(() => {
    if (!tripMode) return;
    if (!dropNavigationTargetId && !gamificationDropsLength && !availableDropPrompt) return;
    const tick = () => {
      if (AppState.currentState !== 'active') return;
      const pose = lastTripMarkerPoseRef.current;
      const lat = pose?.lat ?? userLat;
      const lng = pose?.lng ?? userLng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      void tryClaimGamificationDrop({
        lat: lat!,
        lng: lng!,
        mode: navV3Mode,
        headingDeg: drHdgRef.current ?? lastHeadingRef.current ?? null,
        speedKmh: Number.isFinite(speedKmhRef.current) ? speedKmhRef.current : 0,
      });
    };
    tick();
    const id = setInterval(tick, MAP_PERF.geoDropRefreshActive);
    return () => clearInterval(id);
  }, [
    tripMode,
    navV3Mode,
    dropNavigationTargetId,
    gamificationDropsLength,
    availableDropPrompt,
    userLat,
    userLng,
    tryClaimGamificationDrop,
    lastTripMarkerPoseRef,
    drHdgRef,
    lastHeadingRef,
    speedKmhRef,
  ]);

  useEffect(() => {
    if (!tripMode) return;
    const tick = (force = false) => {
      if (!force && AppState.currentState !== 'active') return;
      const pose = lastTripMarkerPoseRef.current;
      const lat = pose?.lat ?? userLat;
      const lng = pose?.lng ?? userLng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      void refreshGamificationDrops(lat!, lng!, force);
    };
    tick(true);
    const intervalMs = dropNavigationTargetId
      ? MAP_PERF.geoDropRefreshActive
      : MAP_PERF.geoDropRefreshIdle;
    const id = setInterval(() => tick(false), intervalMs);
    return () => clearInterval(id);
  }, [
    tripMode,
    navV3Mode,
    dropNavigationTargetId,
    userLat,
    userLng,
    refreshGamificationDrops,
    lastTripMarkerPoseRef,
  ]);

  useEffect(() => {
    if (!dropNavigationTargetId) return;
    const checkDropClaimed = async () => {
      if (AppState.currentState !== 'active') return;
      const gone = await syncGamificationDropStatus(true);
      if (!gone) return;
      void pollGamificationRewards(true);
    };
    void checkDropClaimed();
    const id = setInterval(() => { void checkDropClaimed(); }, MAP_PERF.geoDropClaimCheck);
    return () => clearInterval(id);
  }, [dropNavigationTargetId, syncGamificationDropStatus, pollGamificationRewards]);
}
