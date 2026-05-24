import React, { memo, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Mapbox from '@rnmapbox/maps';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { type DrPositionMarkerProps } from './DrPositionMarker';
import { useSmoothMapPosition, type SmoothMapPositionValues } from '../../hooks/useSmoothMapPosition';
import {
  feedSmoothPositionTarget,
  subscribeSmoothPositionDisplay,
} from '../../lib/mapPosition/smoothPositionFeed';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { vroomGpsLog } from '../../lib/vroomGpsLog';

const MARKER_SIZE = 40;
const AVATAR_INNER = 34;
const MARKER_BORDER = 2;
const FALLBACK_DOT = 22;

type Props = DrPositionMarkerProps & {
  enabled: boolean;
  /** Gdy podane — pozycja z hooka na MapScreen (handler zawsze zarejestrowany przed feedem GPS). */
  sharedPosition?: SmoothMapPositionValues | null;
};

/**
 * Ten sam marker co w browse (DrPositionMarker + ViewShot), ale pozycja z Reanimated
 * — bez LocationPuck, który na Androidzie renderuje custom PNG jako gigantyczną płaszczyznę 3D.
 */
function isValidCoord(lat: number, lng: number): boolean {
  'worklet';
  return Number.isFinite(lat) && Number.isFinite(lng)
    && !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);
}

export const SmoothDrPositionMarker = memo(function SmoothDrPositionMarker({
  enabled,
  sharedPosition,
  latitude: _lat,
  longitude: _lng,
  heading: _hdg,
  imageUri,
  avatarUrl,
  cursorSkin,
}: Props) {
  const internalSmooth = useSmoothMapPosition(enabled && !sharedPosition);
  const { lat, lng, heading } = sharedPosition ?? internalSmooth;
  const [pose, setPose] = useState({ lat: _lat, lng: _lng, hdg: _hdg });
  const [snapshotFailed, setSnapshotFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const hasValidPoseRef = useRef(false);
  const heartbeatLastLatRef = useRef(0);
  const heartbeatLastLngRef = useRef(0);
  const heartbeatLastChangeMsRef = useRef(Date.now());
  const heartbeatLastEmitMsRef = useRef(0);
  const mediaAvatar = normalizeMediaUri(avatarUrl);
  const skinUri = normalizeMediaUri(cursorSkin?.imageUrl);
  const skinBorder = cursorSkin?.borderColor ?? '#e33835';

  useEffect(() => {
    setSnapshotFailed(false);
  }, [imageUri]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [mediaAvatar]);

  // BOOTSTRAP ONLY — odpalamy raz po zmianie `enabled` (wejście w jazdę/nawigację).
  //
  // KRYTYCZNE: dawniej deps to [_lat, _lng, _hdg] z durationMs:0 — to powodowało
  // INSTANT teleport markera do props (= userLocation entry point + nowy heading)
  // przy KAŻDYM re-renderze rodzica gdy `markerHdg = lastHeadingRef.current` się
  // różnił. W trakcie jazdy DR.onFrame karmi worklet płynnymi forward-projected
  // pozycjami, ale potem nasz useEffect teleportował marker z powrotem do entry
  // pointa userLocation — marker stał w miejscu mimo jazdy 53 km/h.
  //
  // Teraz: bootstrap raz przy enabled=true; dalsze ruchy worklet przez DR.onFrame
  // (map.tsx useDeadReckoning) i bootstrap useEffect w map.tsx po isDriving/
  // isNavigating change.
  useEffect(() => {
    if (!enabled) return;
    if (!isValidCoord(_lat, _lng)) return;
    feedSmoothPositionTarget({
      latitude: _lat,
      longitude: _lng,
      heading: Number.isFinite(_hdg) ? _hdg : 0,
      durationMs: 0,
      source: 'smooth_marker_mount',
    });
    // Świadomie BEZ deps na _lat/_lng/_hdg — fire ma być tylko przy mount/enabled change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Backup: props z MapScreen (tripMarkerDisplay) — gdy worklet/frame nie syncuja UI.
  useEffect(() => {
    if (!enabled) return;
    if (!Number.isFinite(_lat) || !Number.isFinite(_lng)) return;
    if (Math.abs(_lat) < 1e-6 && Math.abs(_lng) < 1e-6) return;
    setPose((prev) => {
      const movedM = Math.hypot(
        (_lat - prev.lat) * 111320,
        (_lng - prev.lng) * 111320 * Math.cos((_lat * Math.PI) / 180),
      );
      if (hasValidPoseRef.current && movedM < 0.12) {
        if (Number.isFinite(_hdg) && Math.abs(_hdg - prev.hdg) > 0.5) {
          return { ...prev, hdg: _hdg };
        }
        return prev;
      }
      hasValidPoseRef.current = true;
      return {
        lat: _lat,
        lng: _lng,
        hdg: Number.isFinite(_hdg) ? _hdg : prev.hdg,
      };
    });
  }, [enabled, _lat, _lng, _hdg]);

  useEffect(() => {
    if (!enabled) {
      setPose({ lat: _lat, lng: _lng, hdg: _hdg });
      return;
    }
    return subscribeSmoothPositionDisplay((slat, slng, shdg) => {
      if (!Number.isFinite(slat) || !Number.isFinite(slng)) return;
      if (Math.abs(slat) < 1e-6 && Math.abs(slng) < 1e-6) return;
      hasValidPoseRef.current = true;
      vroomGpsLog('MARKER_VIEW', {
        lat: Number(slat.toFixed(6)),
        lng: Number(slng.toFixed(6)),
        hdg: Math.round(shdg || 0),
      }, 3000);
      setPose((prev) => {
        const movedM = Math.hypot(
          (slat - prev.lat) * 111320,
          (slng - prev.lng) * 111320 * Math.cos((slat * Math.PI) / 180),
        );
        if (hasValidPoseRef.current && movedM < 0.08 && Math.abs(shdg - prev.hdg) < 1) {
          return prev;
        }
        return { lat: slat, lng: slng, hdg: shdg };
      });

      const nowMs = Date.now();
      const movedM = Math.hypot(
        (slat - heartbeatLastLatRef.current) * 111320,
        (slng - heartbeatLastLngRef.current) * 111320 * Math.cos((slat * Math.PI) / 180),
      );
      if (heartbeatLastLatRef.current === 0 || movedM >= 0.6) {
        heartbeatLastChangeMsRef.current = nowMs;
        heartbeatLastLatRef.current = slat;
        heartbeatLastLngRef.current = slng;
      }
      if (nowMs - heartbeatLastEmitMsRef.current >= 3000) {
        heartbeatLastEmitMsRef.current = nowMs;
        vroomGpsLog('MARKER_HEARTBEAT', {
          stuckMs: Math.round(nowMs - heartbeatLastChangeMsRef.current),
          lat: Number(slat.toFixed(6)),
          lng: Number(slng.toFixed(6)),
          hdg: Math.round(shdg || 0),
          stuck: nowMs - heartbeatLastChangeMsRef.current > 3500,
        }, 0);
      }
    });
  }, [enabled]);

  const markerRotateStyle = useAnimatedStyle(() => {
    const hdg = Number.isFinite(heading.value) ? heading.value : _hdg;
    return {
      transform: [{ rotate: `${Number.isFinite(hdg) ? hdg : 0}deg` }],
    };
  }, [_hdg]);

  if (!enabled) return null;
  const smoothOk = isValidCoord(pose.lat, pose.lng);
  const propsOk = isValidCoord(_lat, _lng);
  const displayLat = smoothOk ? pose.lat : (propsOk ? _lat : NaN);
  const displayLng = smoothOk ? pose.lng : (propsOk ? _lng : NaN);
  if (!Number.isFinite(displayLat) || !Number.isFinite(displayLng)) return null;
  const showAvatar = !!mediaAvatar && !avatarFailed && !skinUri;
  const showSnapshot = !!imageUri && !snapshotFailed && !showAvatar && !skinUri;
  const showSkin = !!skinUri;

  return (
    <Mapbox.MarkerView
      coordinate={[displayLng, displayLat]}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlapWithPuck
      allowOverlap
    >
      {showSkin ? (
        <Animated.View style={[{ width: MARKER_SIZE, height: MARKER_SIZE, alignItems: 'center', justifyContent: 'center' }, markerRotateStyle]}>
          <View
            style={{
              width: MARKER_SIZE,
              height: MARKER_SIZE,
              borderRadius: MARKER_SIZE / 2,
              backgroundColor: '#111',
              borderWidth: MARKER_BORDER + 1,
              borderColor: skinBorder,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Image
              source={{ uri: skinUri }}
              style={{ width: AVATAR_INNER, height: AVATAR_INNER }}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={0}
            />
          </View>
        </Animated.View>
      ) : showAvatar ? (
        <Animated.View style={[{ width: MARKER_SIZE, height: MARKER_SIZE, alignItems: 'center', justifyContent: 'center' }, markerRotateStyle]}>
          <View
            style={{
              width: MARKER_SIZE,
              height: MARKER_SIZE,
              borderRadius: MARKER_SIZE / 2,
              backgroundColor: '#111',
              borderWidth: MARKER_BORDER,
              borderColor: '#e33835',
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Image
              source={{ uri: mediaAvatar }}
              style={{ width: AVATAR_INNER, height: AVATAR_INNER, borderRadius: AVATAR_INNER / 2 }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={0}
              onError={() => setAvatarFailed(true)}
            />
          </View>
        </Animated.View>
      ) : showSnapshot ? (
        <Animated.View style={markerRotateStyle}>
          <Image
            source={{ uri: imageUri! }}
            style={{ width: MARKER_SIZE, height: MARKER_SIZE }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
            onError={() => setSnapshotFailed(true)}
          />
        </Animated.View>
      ) : (
        <Animated.View
          style={[
            {
              width: FALLBACK_DOT,
              height: FALLBACK_DOT,
              borderRadius: FALLBACK_DOT / 2,
              backgroundColor: '#e33835',
              borderWidth: 2,
              borderColor: '#fff',
              shadowColor: '#000',
              shadowOpacity: 0.35,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
              elevation: 4,
            },
            markerRotateStyle,
          ]}
        />
      )}
    </Mapbox.MarkerView>
  );
});
