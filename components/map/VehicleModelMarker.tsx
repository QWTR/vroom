import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Mapbox from '@rnmapbox/maps';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import type { UseDriveMarkerV3Return } from '../../hooks/useDriveMarkerV3';
import type { VehicleModelMeta } from '../../constants/shopCosmetics';
import {
  buildSelfVehicleModelLayerStyle,
  computeVehicleModelYaw,
  computeVehicleModelYawWorklet,
  normalizeHeadingDegWorklet,
  normalizeVehicleModelMeta,
} from '../../lib/vehicleModelMeta';
import { SELF_VEHICLE_MODEL_KEY } from '../../lib/vehicleModelRegistry';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);

const EMPTY_SHAPE = JSON.stringify({
  type: 'FeatureCollection',
  features: [],
});

const COORD_QUANT = 2e-7;
const COORD_EPS = 3e-7;
const HDG_EPS = 0.25;
const MODEL_MIN_ZOOM = 5;
const MOTION_MIN_M = 0.25;

type Props = {
  enabled: boolean;
  isTripActive: boolean;
  driveMarker: UseDriveMarkerV3Return;
  browseLat: number;
  browseLng: number;
  browseHeading: number;
  metadata?: VehicleModelMeta | null;
  modelReady?: boolean;
};

function bearingBetweenWorklet(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  'worklet';
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return normalizeHeadingDegWorklet((Math.atan2(y, x) * 180) / Math.PI);
}

function haversineMWorklet(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  'worklet';
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos((aLat * Math.PI) / 180)
    * Math.cos((bLat * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - s1 - s2));
}

/** Kierunek jazdy: COG z ruchu markera (najpewniejsze), potem pipeline heading. */
function resolveTravelHeadingWorklet(
  pipelineHdg: number,
  prevLat: number,
  prevLng: number,
  lat: number,
  lng: number,
): number {
  'worklet';
  if (
    Number.isFinite(prevLat)
    && Number.isFinite(prevLng)
    && Number.isFinite(lat)
    && Number.isFinite(lng)
    && haversineMWorklet(prevLat, prevLng, lat, lng) >= MOTION_MIN_M
  ) {
    return bearingBetweenWorklet(prevLat, prevLng, lat, lng);
  }
  return normalizeHeadingDegWorklet(pipelineHdg);
}

function buildShapeJson(lat: number, lng: number): string {
  'worklet';
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {},
    }],
  });
}

function VehicleModelMarkerInner({
  enabled,
  isTripActive,
  driveMarker,
  browseLat,
  browseLng,
  browseHeading,
  metadata,
  modelReady = true,
}: Props) {
  const meta = useMemo(() => normalizeVehicleModelMeta(metadata), [metadata]);
  const pitch = Number(meta.pitch) || 0;
  const roll = Number(meta.roll) || 0;
  const yawOffset = Number(meta.yawOffset) || 0;

  const metaKey = useMemo(() => [
    meta.yawOffset,
    meta.pitch,
    meta.roll,
    meta.elevationZ,
    meta.minZoom,
    meta.scale?.join(','),
  ].join('|'), [meta]);

  const layerStyleBase = useMemo(
    () => buildSelfVehicleModelLayerStyle(SELF_VEHICLE_MODEL_KEY, meta),
    [meta, metaKey],
  );

  const [modelRotation, setModelRotation] = useState<[number, number, number]>(() => {
    const yaw = computeVehicleModelYaw(browseHeading, yawOffset);
    return [pitch, roll, yaw];
  });

  const syncModelRotation = useCallback((nextYaw: number) => {
    setModelRotation((prev) => {
      if (Math.abs(prev[2] - nextYaw) <= 0.05) return prev;
      return [pitch, roll, nextYaw];
    });
  }, [pitch, roll]);

  const logLiveDbg = useCallback((payload: Record<string, number>) => {
    if (__DEV__) console.log('[vehicle3d] live', payload);
  }, []);

  const tripActiveSv = useSharedValue(isTripActive ? 1 : 0);
  const browseLatSv = useSharedValue(browseLat);
  const browseLngSv = useSharedValue(browseLng);
  const browseHeadingSv = useSharedValue(browseHeading);
  const yawOffsetSv = useSharedValue(yawOffset);
  const shapeSv = useSharedValue(EMPTY_SHAPE);
  const lastLatSv = useSharedValue(NaN);
  const lastLngSv = useSharedValue(NaN);
  const lastYawSv = useSharedValue(NaN);
  const dbgAtSv = useSharedValue(0);

  const driveLatSv = driveMarker.lat;
  const driveLngSv = driveMarker.lng;
  const driveHdgSv = driveMarker.heading;
  const driveTargetHdgSv = driveMarker.targetHdg;

  useEffect(() => {
    tripActiveSv.value = isTripActive ? 1 : 0;
    browseLatSv.value = browseLat;
    browseLngSv.value = browseLng;
    browseHeadingSv.value = browseHeading;
  }, [isTripActive, browseLat, browseLng, browseHeading, tripActiveSv, browseLatSv, browseLngSv, browseHeadingSv]);

  useEffect(() => {
    yawOffsetSv.value = yawOffset;
    shapeSv.value = EMPTY_SHAPE;
    lastLatSv.value = NaN;
    lastLngSv.value = NaN;
    lastYawSv.value = NaN;
    const yaw = computeVehicleModelYaw(browseHeading, yawOffset);
    setModelRotation([pitch, roll, yaw]);
  }, [metaKey, yawOffset, pitch, roll, browseHeading, yawOffsetSv, shapeSv, lastLatSv, lastLngSv, lastYawSv]);

  const publishFrame = () => {
    'worklet';
    const onTrip = tripActiveSv.value > 0;
    let la = onTrip ? driveLatSv.value : browseLatSv.value;
    let ln = onTrip ? driveLngSv.value : browseLngSv.value;

    const hasValidCoords = Number.isFinite(la) && Number.isFinite(ln)
      && !(Math.abs(la) < 1e-6 && Math.abs(ln) < 1e-6);
    const hasLastCoords = Number.isFinite(lastLatSv.value) && Number.isFinite(lastLngSv.value)
      && !(Math.abs(lastLatSv.value) < 1e-6 && Math.abs(lastLngSv.value) < 1e-6);

    if (!hasValidCoords) {
      if (hasLastCoords) {
        la = lastLatSv.value;
        ln = lastLngSv.value;
      } else {
        if (shapeSv.value !== EMPTY_SHAPE) {
          shapeSv.value = EMPTY_SHAPE;
        }
        return;
      }
    }

    la = Math.round(la / COORD_QUANT) * COORD_QUANT;
    ln = Math.round(ln / COORD_QUANT) * COORD_QUANT;

    let pipelineHdg = onTrip ? driveHdgSv.value : browseHeadingSv.value;
    if (!Number.isFinite(pipelineHdg) && Number.isFinite(driveTargetHdgSv.value)) {
      pipelineHdg = driveTargetHdgSv.value;
    }
    pipelineHdg = Number.isFinite(pipelineHdg) ? pipelineHdg : 0;

    const prevLa = lastLatSv.value;
    const prevLn = lastLngSv.value;
    const travelHdg = resolveTravelHeadingWorklet(pipelineHdg, prevLa, prevLn, la, ln);
    const modelYaw = computeVehicleModelYawWorklet(travelHdg, yawOffsetSv.value);

    const prevYaw = lastYawSv.value;
    const posSame = Number.isFinite(prevLa)
      && Number.isFinite(prevLn)
      && Math.abs(la - prevLa) <= COORD_EPS
      && Math.abs(ln - prevLn) <= COORD_EPS;
    const yawSame = Number.isFinite(prevYaw) && Math.abs(modelYaw - prevYaw) <= HDG_EPS;

    if (posSame && yawSame) {
      return;
    }

    lastLatSv.value = la;
    lastLngSv.value = ln;
    lastYawSv.value = modelYaw;
    shapeSv.value = buildShapeJson(la, ln);

    if (!yawSame) {
      runOnJS(syncModelRotation)(modelYaw);
    }

    if (__DEV__) {
      const now = Date.now();
      if (now - dbgAtSv.value >= 1500) {
        dbgAtSv.value = now;
        runOnJS(logLiveDbg)({
          onTrip: onTrip ? 1 : 0,
          pipe: Math.round(normalizeHeadingDegWorklet(pipelineHdg) * 10) / 10,
          travel: Math.round(travelHdg * 10) / 10,
          yaw: Math.round(modelYaw * 10) / 10,
          off: Math.round(yawOffsetSv.value * 10) / 10,
        });
      }
    }
  };

  const frameCallback = useFrameCallback(() => {
    'worklet';
    publishFrame();
  }, false);

  useEffect(() => {
    frameCallback.setActive(enabled && modelReady);
    return () => frameCallback.setActive(false);
  }, [enabled, modelReady, frameCallback]);

  const animatedShapeProps = useAnimatedProps(() => {
    'worklet';
    return { shape: shapeSv.value };
  });

  const layerStyle = useMemo(
    () => ({
      ...layerStyleBase,
      modelRotation,
    }),
    [layerStyleBase, modelRotation],
  );

  if (!enabled || !modelReady) return null;

  const minZoom = Math.min(MODEL_MIN_ZOOM, meta.minZoom ?? MODEL_MIN_ZOOM);

  return (
    <ReanimatedShapeSource
      id="vehicle-model-src"
      animatedProps={animatedShapeProps as never}
    >
      <Mapbox.ModelLayer
        key={`vehicle-model-layer-${metaKey}`}
        id="vehicle-model-layer"
        minZoomLevel={minZoom}
        style={layerStyle}
      />
    </ReanimatedShapeSource>
  );
}

export const VehicleModelMarker = memo(VehicleModelMarkerInner);
