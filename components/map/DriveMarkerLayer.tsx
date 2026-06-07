import React, { memo, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Mapbox from '@rnmapbox/maps';
import type { DriveMarkerValues } from '../../hooks/useDriveMarker';
import { driveTraceMarkerUiSmooth } from '../../lib/driveSessionTrace';
import { visionFrame } from '../../lib/driveVisionTrace';
import { DRIVE_FULL_VISION_LOG } from '../../lib/driveLogConfig';
import { normalizeMediaUri } from '../../lib/mediaUri';

const MARKER_SIZE = 40;
const AVATAR_INNER = 34;
const MARKER_BORDER = 2;
const FALLBACK_DOT = 22;
/** Telemetria UI co ~500 ms (60 fps render bez throttlingu). */
const UI_TELEMETRY_EVERY_N_FRAMES = 30;

function isValidMarkerCoord(la: number, ln: number): boolean {
  return Number.isFinite(la)
    && Number.isFinite(ln)
    && !(Math.abs(la) < 1e-6 && Math.abs(ln) < 1e-6);
}

type Props = {
  enabled: boolean;
  marker: DriveMarkerValues;
  /** Unified trip sync — parent rAF drives pose (same SV read as camera). */
  externalPose?: DriveMarkerTripPose | null;
  externalVisible?: boolean;
  imageUri?: string | null;
  avatarUrl?: string | null;
  cursorSkin?: { imageUrl?: string; borderColor?: string } | null;
};

type DriveMarkerTripPose = { lat: number; lng: number; hdg: number };

/**
 * Trip marker — MarkerView + rAF odczyt SharedValues (60 fps, telemetria odpięta od renderu).
 */
export const DriveMarkerLayer = memo(function DriveMarkerLayer({
  enabled,
  marker,
  externalPose = null,
  externalVisible,
  imageUri,
  avatarUrl,
  cursorSkin,
}: Props) {
  const useExternalPose = externalPose != null;
  const [visible, setVisible] = useState(false);
  const [pose, setPose] = useState({ lat: 0, lng: 0, hdg: 0 });
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [snapshotFailed, setSnapshotFailed] = useState(false);

  useEffect(() => {
    if (useExternalPose || !enabled) {
      if (!useExternalPose) setVisible(false);
      return;
    }
    let rafId = 0;
    let alive = true;
    let frameCount = 0;
    let lastTelemetryAt = 0;
    let lastPose = { lat: 0, lng: 0, hdg: 0 };
    const loop = () => {
      if (!alive) return;
      const la = marker.lat.value;
      const ln = marker.lng.value;
      const h = marker.heading.value;
      if (isValidMarkerCoord(la, ln)) {
        const normHdg = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
        setPose({ lat: la, lng: ln, hdg: normHdg });
        setVisible(true);

        frameCount += 1;
        const now = Date.now();
        const msSincePrevTelemetry = lastTelemetryAt > 0 ? now - lastTelemetryAt : 0;
        if (
          DRIVE_FULL_VISION_LOG
          && (frameCount % UI_TELEMETRY_EVERY_N_FRAMES === 0 || lastTelemetryAt === 0)
        ) {
          const uiMoveM = lastTelemetryAt > 0
            ? Math.hypot(
              (la - lastPose.lat) * 111320,
              (ln - lastPose.lng) * 111320 * Math.cos((la * Math.PI) / 180),
            )
            : 0;
          const uiHdgDeltaDeg = lastTelemetryAt > 0
            ? Math.abs(((normHdg - lastPose.hdg + 540) % 360) - 180)
            : 0;
          driveTraceMarkerUiSmooth({
            lat: la,
            lng: ln,
            hdg: normHdg,
            uiMoveM,
            uiHdgDeltaDeg,
            msSinceCommit: msSincePrevTelemetry > 0 ? msSincePrevTelemetry : 16,
          });
          visionFrame({
            layer: 'ui',
            svLat: la,
            svLng: ln,
            svHdg: normHdg,
            uiLat: la,
            uiLng: ln,
            uiHdg: normHdg,
            frameDtMs: msSincePrevTelemetry > 0 ? msSincePrevTelemetry : 16,
            impliedKmh: msSincePrevTelemetry > 16 && uiMoveM > 0
              ? (uiMoveM / (msSincePrevTelemetry / 1000)) * 3.6
              : 0,
            stuck: uiMoveM < 0.05 && msSincePrevTelemetry > 2000,
            msSinceCommit: msSincePrevTelemetry,
          });
          lastPose = { lat: la, lng: ln, hdg: normHdg };
          lastTelemetryAt = now;
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    const la0 = marker.lat.value;
    const ln0 = marker.lng.value;
    const h0 = marker.heading.value;
    if (isValidMarkerCoord(la0, ln0)) {
      setPose({
        lat: la0,
        lng: ln0,
        hdg: Number.isFinite(h0) ? ((h0 % 360) + 360) % 360 : 0,
      });
      setVisible(true);
      lastPose = {
        lat: la0,
        lng: ln0,
        hdg: Number.isFinite(h0) ? ((h0 % 360) + 360) % 360 : 0,
      };
      lastTelemetryAt = Date.now();
    }
    rafId = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
  }, [enabled, marker.lat, marker.lng, marker.heading, useExternalPose]);

  const displayPose = useExternalPose && externalPose ? externalPose : pose;
  const displayVisible = useExternalPose
    ? (externalVisible ?? false)
    : visible;

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);

  useEffect(() => {
    setSnapshotFailed(false);
  }, [imageUri]);

  if (!enabled || !displayVisible) return null;

  const mediaAvatar = normalizeMediaUri(avatarUrl);
  const skinUri = normalizeMediaUri(cursorSkin?.imageUrl);
  const skinBorder = cursorSkin?.borderColor ?? '#e33835';
  const showSkin = !!skinUri;
  const showAvatar = !!mediaAvatar && !avatarFailed && !showSkin;
  const showSnapshot = !!imageUri && !snapshotFailed && !showAvatar && !showSkin;
  const markerTransform = { transform: [{ rotate: `${displayPose.hdg}deg` }] as const };

  return (
    <Mapbox.MarkerView
      coordinate={[displayPose.lng, displayPose.lat]}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlapWithPuck
      allowOverlap
    >
      {showSkin ? (
        <View style={[{ width: MARKER_SIZE, height: MARKER_SIZE, alignItems: 'center', justifyContent: 'center' }, markerTransform]}>
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
        </View>
      ) : showAvatar ? (
        <View style={[{ width: MARKER_SIZE, height: MARKER_SIZE, alignItems: 'center', justifyContent: 'center' }, markerTransform]}>
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
        </View>
      ) : showSnapshot ? (
        <Image
          source={{ uri: imageUri! }}
          style={{ width: MARKER_SIZE, height: MARKER_SIZE, ...markerTransform }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
          onError={() => setSnapshotFailed(true)}
        />
      ) : (
        <View
          style={{
            width: FALLBACK_DOT,
            height: FALLBACK_DOT,
            borderRadius: FALLBACK_DOT / 2,
            backgroundColor: '#e33835',
            borderWidth: 2,
            borderColor: '#fff',
            ...markerTransform,
          }}
        />
      )}
    </Mapbox.MarkerView>
  );
});
