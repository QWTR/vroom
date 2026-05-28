import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Mapbox from '@rnmapbox/maps';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { type DrPositionMarkerProps } from './DrPositionMarker';
import { useSmoothMapPosition, type SmoothMapPositionValues } from '../../hooks/useSmoothMapPosition';
import { feedSmoothPositionTarget } from '../../lib/mapPosition/smoothPositionFeed';
import { normalizeMediaUri } from '../../lib/mediaUri';
import { markerLogTick } from '../../lib/markerPipelineLog';
import { logGpsTickLayer, logGpsTickLayerThrottled } from '../../lib/gpsTickTraceLog';
import { vroomGpsLog } from '../../lib/vroomGpsLog';

const MARKER_SIZE = 40;
const AVATAR_INNER = 34;
const MARKER_BORDER = 2;
const FALLBACK_DOT = 22;

/** Min. zmiana współrzędnych zanim wywołamy setPose (Mapbox MarkerView wymaga JS props). */
const COORD_EPS = 1e-7;

type Props = DrPositionMarkerProps & {
  enabled: boolean;
  sharedPosition?: SmoothMapPositionValues | null;
  /** V10: tylko SharedValue z workletu — bez fallbacku na props/userLocation. */
  workletOnly?: boolean;
};

function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);
}

type CoordPose = { lat: number; lng: number };

type BodyProps = Omit<Props, 'sharedPosition'> & {
  smooth: SmoothMapPositionValues;
};

const SmoothDrPositionMarkerBody = memo(function SmoothDrPositionMarkerBody({
  enabled,
  smooth,
  latitude: _lat,
  longitude: _lng,
  heading: _hdg,
  imageUri,
  avatarUrl,
  cursorSkin,
  workletOnly = false,
}: BodyProps) {
  const { lat, lng, heading } = smooth;

  const [pose, setPose] = useState<CoordPose>(() => (
    workletOnly
      ? { lat: NaN, lng: NaN }
      : { lat: _lat, lng: _lng }
  ));

  const [snapshotFailed, setSnapshotFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const lastPoseRef = useRef<CoordPose>({ lat: _lat, lng: _lng });
  const lastPushMsRef = useRef(0);
  const heartbeatLastChangeMsRef = useRef(Date.now());
  const heartbeatLastEmitMsRef = useRef(0);

  const mediaAvatar = normalizeMediaUri(avatarUrl);
  const skinUri = normalizeMediaUri(cursorSkin?.imageUrl);
  const skinBorder = cursorSkin?.borderColor ?? '#e33835';

  const maybeCommitCoords = useCallback((slat: number, slng: number) => {
    const prev = lastPoseRef.current;
    if (
      Math.abs(slat - prev.lat) <= COORD_EPS
      && Math.abs(slng - prev.lng) <= COORD_EPS
    ) {
      return false;
    }
    const nowMs = Date.now();
    const next = { lat: slat, lng: slng };
    lastPoseRef.current = next;
    lastPushMsRef.current = nowMs;
    heartbeatLastChangeMsRef.current = nowMs;
    setPose(next);

    const moveM = Math.sqrt(
      ((next.lat - prev.lat) * 111320) ** 2
      + ((next.lng - prev.lng) * 111320 * Math.cos((next.lat * Math.PI) / 180)) ** 2,
    );
    if (moveM >= 0.5) {
      markerLogTick('MARKER_UI_PUSH', {
        moveM: Number(moveM.toFixed(2)),
        lat: Number(next.lat.toFixed(6)),
        lng: Number(next.lng.toFixed(6)),
        stream: 'shared_value_bridge',
      }, 600);
    }

    if (nowMs - heartbeatLastEmitMsRef.current >= 3000) {
      heartbeatLastEmitMsRef.current = nowMs;
      vroomGpsLog('MARKER_HEARTBEAT', {
        stuckMs: Math.round(nowMs - heartbeatLastChangeMsRef.current),
        lat: Number(slat.toFixed(6)),
        lng: Number(slng.toFixed(6)),
        hdg: Math.round(heading.value || 0),
        stuck: nowMs - heartbeatLastChangeMsRef.current > 3500,
        stream: 'shared_value_bridge',
      }, 0);
    }
    return true;
  }, [heading]);

  useAnimatedReaction(
    () => {
      if (!enabled) return null;
      return {
        lat: lat.value,
        lng: lng.value,
      };
    },
    (next, prev) => {
      if (!next) return;
      if (
        prev
        && Math.abs(next.lat - prev.lat) <= COORD_EPS
        && Math.abs(next.lng - prev.lng) <= COORD_EPS
      ) {
        return;
      }
      runOnJS(maybeCommitCoords)(next.lat, next.lng);
    },
    [enabled, maybeCommitCoords],
  );

  useEffect(() => {
    setSnapshotFailed(false);
  }, [imageUri]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [mediaAvatar]);

  useEffect(() => {
    if (!enabled || workletOnly) return;
    if (!isValidCoord(_lat, _lng)) return;
    feedSmoothPositionTarget({
      latitude: _lat,
      longitude: _lng,
      heading: Number.isFinite(_hdg) ? _hdg : 0,
      durationMs: 320,
      source: 'smooth_marker_mount',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, workletOnly]);

  useEffect(() => {
    if (!enabled) {
      setPose({ lat: _lat, lng: _lng });
      lastPoseRef.current = { lat: _lat, lng: _lng };
      return;
    }
    if (workletOnly) {
      setPose({ lat: NaN, lng: NaN });
      lastPoseRef.current = { lat: NaN, lng: NaN };
    }
  }, [enabled, workletOnly, _lat, _lng]);

  const markerRotateStyle = useAnimatedStyle(() => {
    const hdg = Number.isFinite(heading.value) ? heading.value : _hdg;
    return {
      transform: [{ rotate: `${Number.isFinite(hdg) ? hdg : 0}deg` }],
    };
  }, [_hdg]);

  const lastRenderLogMsRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const smoothOkTick = isValidCoord(pose.lat, pose.lng);
      const propsOkTick = !workletOnly && isValidCoord(_lat, _lng);
      const tickDisplayLat = smoothOkTick ? pose.lat : (propsOkTick ? _lat : NaN);
      const tickDisplayLng = smoothOkTick ? pose.lng : (propsOkTick ? _lng : NaN);
      const coordSource = workletOnly
        ? (smoothOkTick ? 'shared_value_pose' : 'shared_value_fallback')
        : (smoothOkTick ? 'shared_pose' : (propsOkTick ? 'props_fallback_lat' : 'none'));
      logGpsTickLayerThrottled('MARKER_UI_RENDER', {
        enabled,
        workletOnly,
        displayLat: Number.isFinite(tickDisplayLat) ? Number(tickDisplayLat.toFixed(6)) : null,
        displayLng: Number.isFinite(tickDisplayLng) ? Number(tickDisplayLng.toFixed(6)) : null,
        coordSource,
        poseLat: smoothOkTick ? Number(pose.lat.toFixed(6)) : null,
        poseLng: smoothOkTick ? Number(pose.lng.toFixed(6)) : null,
        propsLat: propsOkTick ? Number(_lat.toFixed(6)) : null,
        propsLng: propsOkTick ? Number(_lng.toFixed(6)) : null,
        propsWouldLeak: propsOkTick && smoothOkTick
          && (Math.abs(_lat - pose.lat) > 1e-5 || Math.abs(_lng - pose.lng) > 1e-5),
        msSinceCoordPush: Date.now() - lastPushMsRef.current,
      }, 1000);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [enabled, workletOnly, pose.lat, pose.lng, _lat, _lng]);

  if (!enabled) return null;

  const smoothOk = isValidCoord(pose.lat, pose.lng);
  const propsOk = isValidCoord(_lat, _lng);
  const displayLat = smoothOk
    ? pose.lat
    : _lat;
  const displayLng = smoothOk
    ? pose.lng
    : _lng;
  const renderSource = smoothOk ? 'worklet_pose' : 'props_fallback';

  if (enabled && Number.isFinite(displayLat) && Number.isFinite(displayLng)) {
    const nowRender = Date.now();
    const propsRawLeak = workletOnly && propsOk
      && (Math.abs(_lat - pose.lat) > 1e-5 || Math.abs(_lng - pose.lng) > 1e-5);
    if (
      propsRawLeak
      || renderSource === 'props_parent'
      || nowRender - lastRenderLogMsRef.current >= 500
    ) {
      lastRenderLogMsRef.current = nowRender;
      logGpsTickLayer('MARKER_UI_RENDER_SOURCE', {
        renderSource,
        workletOnly,
        coordinateLat: Number(displayLat.toFixed(6)),
        coordinateLng: Number(displayLng.toFixed(6)),
        poseLat: Number.isFinite(pose.lat) ? Number(pose.lat.toFixed(6)) : null,
        poseLng: Number.isFinite(pose.lng) ? Number(pose.lng.toFixed(6)) : null,
        propsLat: Number.isFinite(_lat) ? Number(_lat.toFixed(6)) : null,
        propsLng: Number.isFinite(_lng) ? Number(_lng.toFixed(6)) : null,
        propsWouldRender: propsOk && !workletOnly,
        propsRawLeak,
        poseAgeMs: nowRender - lastPushMsRef.current,
      });
    }
  }

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

const SmoothDrPositionMarkerWithHook = memo(function SmoothDrPositionMarkerWithHook(props: Props) {
  const internalSmooth = useSmoothMapPosition(props.enabled);
  return <SmoothDrPositionMarkerBody {...props} smooth={internalSmooth} />;
});

export const SmoothDrPositionMarker = memo(function SmoothDrPositionMarker(props: Props) {
  if (props.sharedPosition) {
    return <SmoothDrPositionMarkerBody {...props} smooth={props.sharedPosition} />;
  }
  return <SmoothDrPositionMarkerWithHook {...props} />;
});
