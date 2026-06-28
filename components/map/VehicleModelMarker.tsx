import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Mapbox from '@rnmapbox/maps';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
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

const SOURCE_ID = 'vehicle-model-src';

const EMPTY_SHAPE = JSON.stringify({
  type: 'FeatureCollection',
  features: [],
});

const COORD_QUANT = 2e-7;
const COORD_EPS = 3e-7;
const MODEL_MIN_ZOOM = 5;
/** Rotacja: literal modelRotation (data-driven renderuje inną konwencją → zły heading). */
const ROT_PUSH_MIN_DEG = 1.5;   // kwantyzacja kąta — mniej relayoutów
const ROT_PUSH_MIN_MS = 60;     // throttle

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

/** GeoJSON tylko z pozycją — płynnie co klatkę przez animatedProps, źródło NIGDY się nie re-renderuje. */
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

/**
 * Osobna warstwa modelu (sourceID → źródło pozycji). Re-renderuje się TYLKO ona przy zmianie kąta,
 * więc źródło pozycji (ShapeSource) nie miga. Rotacja literalna = poprawny heading (jak panel).
 */
const SelfModelLayer = memo(function SelfModelLayer({
  modelYawSv,
  pitch,
  roll,
  layerBase,
  minZoom,
  layerKey,
  initialYaw,
}: {
  modelYawSv: SharedValue<number>;
  pitch: number;
  roll: number;
  layerBase: object;
  minZoom: number;
  layerKey: string;
  initialYaw: number;
}) {
  const [yaw, setYaw] = useState(initialYaw);
  const lastPushedSv = useSharedValue(NaN);
  const lastAtSv = useSharedValue(0);

  const pushYaw = useCallback((v: number) => {
    setYaw((prev) => (Math.abs(prev - v) < 0.01 ? prev : v));
  }, []);

  useAnimatedReaction(
    () => modelYawSv.value,
    (v) => {
      'worklet';
      if (!Number.isFinite(v)) return;
      const now = Date.now();
      const prev = lastPushedSv.value;
      const delta = Number.isFinite(prev) ? Math.abs(((v - prev + 540) % 360) - 180) : 999;
      if (delta >= ROT_PUSH_MIN_DEG && now - lastAtSv.value >= ROT_PUSH_MIN_MS) {
        lastPushedSv.value = v;
        lastAtSv.value = now;
        runOnJS(pushYaw)(v);
      }
    },
  );

  const style = useMemo(
    () => ({ ...layerBase, modelRotation: [pitch, roll, yaw] as [number, number, number] }),
    [layerBase, pitch, roll, yaw],
  );

  return (
    <Mapbox.ModelLayer
      key={`vehicle-model-layer-${layerKey}`}
      id="vehicle-model-layer"
      sourceID={SOURCE_ID}
      minZoomLevel={minZoom}
      style={style}
    />
  );
});

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

  const layerBase = useMemo(
    () => buildSelfVehicleModelLayerStyle(SELF_VEHICLE_MODEL_KEY, meta),
    [meta, metaKey],
  );

  const initialYaw = useMemo(
    () => computeVehicleModelYaw(browseHeading, yawOffset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metaKey],
  );

  const logLiveDbg = useCallback((s: string) => {
    if (__DEV__) console.log(`[vehicle3d] ${s}`);
  }, []);

  const tripActiveSv = useSharedValue(isTripActive ? 1 : 0);
  const browseLatSv = useSharedValue(browseLat);
  const browseLngSv = useSharedValue(browseLng);
  const browseHeadingSv = useSharedValue(browseHeading);
  const yawOffsetSv = useSharedValue(yawOffset);
  const shapeSv = useSharedValue(EMPTY_SHAPE);
  const modelYawSv = useSharedValue(initialYaw);
  const lastLatSv = useSharedValue(NaN);
  const lastLngSv = useSharedValue(NaN);
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
  }, [metaKey, yawOffset, yawOffsetSv, shapeSv, lastLatSv, lastLngSv]);

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

    // pipelineHdg już wygładzony w useDriveMarkerV3 — tylko + yawOffset.
    modelYawSv.value = computeVehicleModelYawWorklet(pipelineHdg, yawOffsetSv.value);

    const prevLa = lastLatSv.value;
    const prevLn = lastLngSv.value;
    const posChanged = !(Number.isFinite(prevLa) && Number.isFinite(prevLn)
      && Math.abs(la - prevLa) <= COORD_EPS && Math.abs(ln - prevLn) <= COORD_EPS);
    if (posChanged) {
      lastLatSv.value = la;
      lastLngSv.value = ln;
      shapeSv.value = buildShapeJson(la, ln);
    }

    if (__DEV__ && Date.now() - dbgAtSv.value >= 1500) {
      dbgAtSv.value = Date.now();
      const r = (n: number) => Math.round(normalizeHeadingDegWorklet(n) * 10) / 10;
      runOnJS(logLiveDbg)(
        `trip=${onTrip ? 1 : 0} pipe=${r(pipelineHdg)} yaw=${Math.round(modelYawSv.value * 10) / 10} off=${yawOffsetSv.value}`,
      );
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

  if (!enabled || !modelReady) return null;

  const minZoom = Math.min(MODEL_MIN_ZOOM, meta.minZoom ?? MODEL_MIN_ZOOM);

  return (
    <>
      <ReanimatedShapeSource
        id={SOURCE_ID}
        animatedProps={animatedShapeProps as never}
      />
      <SelfModelLayer
        modelYawSv={modelYawSv}
        pitch={pitch}
        roll={roll}
        layerBase={layerBase}
        minZoom={minZoom}
        layerKey={metaKey}
        initialYaw={initialYaw}
      />
    </>
  );
}

export const VehicleModelMarker = memo(VehicleModelMarkerInner);
