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
import { logGpsTickLayer } from '../../lib/gpsTickTraceLog';
import { vroomGpsLog } from '../../lib/vroomGpsLog';



const MARKER_SIZE = 40;

const AVATAR_INNER = 34;

const MARKER_BORDER = 2;

const FALLBACK_DOT = 22;

/** Throttle aktualizacji MarkerView (Mapbox wymaga props z JS). */

/** 60 FPS — Mapbox MarkerView wymaga props z JS (SharedValue = heading). */
const MARKER_COORD_PUSH_MS = 16;



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

  const [pose, setPose] = useState(() => (
    workletOnly
      ? { lat: NaN, lng: NaN, hdg: _hdg }
      : { lat: _lat, lng: _lng, hdg: _hdg }
  ));

  const [snapshotFailed, setSnapshotFailed] = useState(false);

  const [avatarFailed, setAvatarFailed] = useState(false);

  const lastPushMsRef = useRef(0);
  const lastPoseRef = useRef({ lat: _lat, lng: _lng, hdg: _hdg });

  const heartbeatLastChangeMsRef = useRef(Date.now());

  const heartbeatLastEmitMsRef = useRef(0);

  const mediaAvatar = normalizeMediaUri(avatarUrl);

  const skinUri = normalizeMediaUri(cursorSkin?.imageUrl);

  const skinBorder = cursorSkin?.borderColor ?? '#e33835';



  const pushMarkerCoord = useCallback((slat: number, slng: number, shdg: number) => {

    const nowMs = Date.now();

    if (nowMs - lastPushMsRef.current < MARKER_COORD_PUSH_MS) return;

    lastPushMsRef.current = nowMs;

    setPose((prev) => {

      const next = {

        lat: slat,

        lng: slng,

        hdg: Number.isFinite(shdg) ? shdg : prev.hdg,

      };

      const moved =

        Math.abs(next.lat - prev.lat) > 1e-6

        || Math.abs(next.lng - prev.lng) > 1e-6

        || Math.abs(next.hdg - prev.hdg) >= 0.4;

      if (moved) {
        heartbeatLastChangeMsRef.current = nowMs;
        const prev = lastPoseRef.current;
        const moveM = Math.sqrt(
          ((next.lat - prev.lat) * 111320) ** 2
          + ((next.lng - prev.lng) * 111320 * Math.cos((next.lat * Math.PI) / 180)) ** 2,
        );
        const hdgDelta = Math.abs(((next.hdg - prev.hdg + 540) % 360) - 180);
        lastPoseRef.current = next;
        if (moveM >= 0.5 || hdgDelta >= 8) {
          markerLogTick('MARKER_UI_PUSH', {
            moveM: Number(moveM.toFixed(2)),
            hdgDelta: Math.round(hdgDelta),
            lat: Number(next.lat.toFixed(6)),
            lng: Number(next.lng.toFixed(6)),
          }, 600);
        }
      }

      return next;

    });

    if (nowMs - heartbeatLastEmitMsRef.current >= 3000) {

      heartbeatLastEmitMsRef.current = nowMs;

      vroomGpsLog('MARKER_HEARTBEAT', {

        stuckMs: Math.round(nowMs - heartbeatLastChangeMsRef.current),

        lat: Number(slat.toFixed(6)),

        lng: Number(slng.toFixed(6)),

        hdg: Math.round(shdg || 0),

        stuck: nowMs - heartbeatLastChangeMsRef.current > 3500,

        stream: 'shared_value',

      }, 0);

    }

  }, []);



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



  useAnimatedReaction(

    () => ({

      lat: lat.value,

      lng: lng.value,

      hdg: heading.value,

      on: enabled ? 1 : 0,

    }),

    (cur) => {

      if (cur.on !== 1) return;

      if (!Number.isFinite(cur.lat) || !Number.isFinite(cur.lng)) return;

      if (Math.abs(cur.lat) < 1e-6 && Math.abs(cur.lng) < 1e-6) return;

      runOnJS(pushMarkerCoord)(cur.lat, cur.lng, cur.hdg);

    },

    [enabled, pushMarkerCoord],

  );



  useEffect(() => {

    if (!enabled) {

      setPose({ lat: _lat, lng: _lng, hdg: _hdg });

      return;

    }

    if (workletOnly) {

      setPose({ lat: NaN, lng: NaN, hdg: _hdg });

    }

  }, [enabled, workletOnly, _lat, _lng, _hdg]);



  const markerRotateStyle = useAnimatedStyle(() => {

    const hdg = Number.isFinite(heading.value) ? heading.value : _hdg;

    return {

      transform: [{ rotate: `${Number.isFinite(hdg) ? hdg : 0}deg` }],

    };

  }, [_hdg]);



  if (!enabled) return null;

  const smoothOk = isValidCoord(pose.lat, pose.lng);

  const propsOk = !workletOnly && isValidCoord(_lat, _lng);

  const displayLat = smoothOk ? pose.lat : (propsOk ? _lat : NaN);

  const displayLng = smoothOk ? pose.lng : (propsOk ? _lng : NaN);

  const renderSource = workletOnly
    ? (smoothOk ? 'worklet_pose' : 'worklet_waiting')
    : (smoothOk ? 'worklet_pose' : (propsOk ? 'props_parent' : 'none'));

  const lastRenderLogMsRef = useRef(0);

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

  if (workletOnly && !smoothOk) return null;
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


