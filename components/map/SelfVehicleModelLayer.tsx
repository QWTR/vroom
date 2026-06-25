import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  buildModelLayerTranslation,
  buildStaticModelRotation,
  normalizeVehicleModelMeta,
} from '../../lib/vehicleModelMeta';
import { resolveMapVehicleScale } from '../../lib/mapVehicleScale';
import { SELF_VEHICLE_MODEL_KEY } from '../../lib/vehicleModelRegistry';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);

const EMPTY_SHAPE = JSON.stringify({
  type: 'FeatureCollection',
  features: [],
});

const COORD_QUANT = 2e-7;
const COORD_EPS = 3e-7;
const YAW_PUSH_EPS = 0.08;

type ModelLayerStyleState = {
  modelRotation: [number, number, number];
  modelScale: [number, number, number];
  modelTranslation: [number, number, number];
};

function headingDeltaW(from: number, to: number): number {
  'worklet';
  return ((to - from + 540) % 360) - 180;
}

function unwrapYawToward(prevUnwrapped: number, wrappedTarget: number): number {
  'worklet';
  if (!Number.isFinite(prevUnwrapped)) return wrappedTarget;
  return prevUnwrapped + headingDeltaW(prevUnwrapped, wrappedTarget);
}

function normalizeHeadingW(h: number): number {
  'worklet';
  return ((h % 360) + 360) % 360;
}

type Props = {
  marker: UseDriveMarkerV3Return;
  metadata?: VehicleModelMeta | null;
  visible?: boolean;
};

function SelfVehicleModelLayerInner({
  marker,
  metadata,
  visible = true,
}: Props) {
  const meta = useMemo(() => normalizeVehicleModelMeta(metadata), [metadata]);
  const [sx, sy, sz] = useMemo(() => resolveMapVehicleScale(meta.scale), [meta.scale]);
  const modelTranslation = useMemo(() => buildModelLayerTranslation(meta), [meta]);
  const metaKey = [
    meta.rotationOffset,
    meta.rotationPitch,
    meta.rotationRoll,
    ...modelTranslation,
    sx, sy, sz,
  ].join('|');

  const pitch = Number(meta.rotationPitch) || 0;
  const roll = Number(meta.rotationRoll) || 0;
  const rotOffset = Number(meta.rotationOffset) || 0;

  const initialRotation = useMemo(
    () => buildStaticModelRotation(meta, 0),
    [meta],
  );

  const [layerStyle, setLayerStyle] = useState<ModelLayerStyleState>(() => ({
    modelRotation: initialRotation,
    modelScale: [sx, sy, sz],
    modelTranslation,
  }));

  const layerRef = useRef<{ setNativeProps?: (props: { style: object }) => void } | null>(null);
  const scaleRef = useRef<[number, number, number]>([sx, sy, sz]);
  const transRef = useRef<[number, number, number]>(modelTranslation);

  useEffect(() => {
    scaleRef.current = [sx, sy, sz];
    transRef.current = modelTranslation;
    const next: ModelLayerStyleState = {
      modelRotation: buildStaticModelRotation(meta, 0),
      modelScale: [sx, sy, sz],
      modelTranslation,
    };
    setLayerStyle(next);
    layerRef.current?.setNativeProps?.({ style: {
      modelId: SELF_VEHICLE_MODEL_KEY,
      modelType: 'common-3d',
      modelElevationReference: 'ground',
      modelOpacity: 1,
      modelCastShadows: false,
      modelReceiveShadows: false,
      modelAllowDensityReduction: true,
      ...next,
    } });
    if (__DEV__) {
      console.log('[vehicle3d] self layer meta', {
        rotationOffset: rotOffset,
        pitch,
        roll,
        translation: modelTranslation,
        scale: [sx, sy, sz],
        formula: 'yaw = heading + rotationOffset (jak panel)',
      });
    }
  }, [metaKey, pitch, roll, rotOffset, sx, sy, sz, modelTranslation, meta]);

  const pitchSv = useSharedValue(pitch);
  const rollSv = useSharedValue(roll);
  const rotOffsetSv = useSharedValue(rotOffset);
  const lastUnwrappedYaw = useSharedValue(NaN);
  const lastPushedYaw = useSharedValue(NaN);

  useEffect(() => {
    pitchSv.value = pitch;
    rollSv.value = roll;
    rotOffsetSv.value = rotOffset;
    lastUnwrappedYaw.value = NaN;
    lastPushedYaw.value = NaN;
  }, [metaKey, pitch, roll, rotOffset, pitchSv, rollSv, rotOffsetSv, lastUnwrappedYaw, lastPushedYaw]);

  const pushLayerRotation = useCallback((yawUnwrapped: number) => {
    const yawForMap = ((yawUnwrapped % 360) + 360) % 360;
    const nextRot: [number, number, number] = [pitch, roll, yawForMap];

    setLayerStyle((prev) => {
      if (Math.abs(prev.modelRotation[2] - nextRot[2]) < YAW_PUSH_EPS) return prev;
      return { ...prev, modelRotation: nextRot };
    });

    layerRef.current?.setNativeProps?.({
      style: {
        modelId: SELF_VEHICLE_MODEL_KEY,
        modelType: 'common-3d',
        modelElevationReference: 'ground',
        modelOpacity: 1,
        modelCastShadows: false,
        modelReceiveShadows: false,
        modelAllowDensityReduction: true,
        modelRotation: nextRot,
        modelScale: scaleRef.current,
        modelTranslation: transRef.current,
      },
    });
  }, [pitch, roll]);

  const lastShape = useSharedValue(EMPTY_SHAPE);
  const lastLat = useSharedValue(NaN);
  const lastLng = useSharedValue(NaN);

  useEffect(() => {
    lastShape.value = EMPTY_SHAPE;
    lastLat.value = NaN;
    lastLng.value = NaN;
  }, [metaKey, lastShape, lastLat, lastLng]);

  const animatedShapeProps = useAnimatedProps(() => {
    'worklet';
    let la = marker.lat.value;
    let ln = marker.lng.value;

    const hasValidCoords = Number.isFinite(la) && Number.isFinite(ln)
      && !(Math.abs(la) < 1e-6 && Math.abs(ln) < 1e-6);
    const hasLastCoords = Number.isFinite(lastLat.value) && Number.isFinite(lastLng.value)
      && !(Math.abs(lastLat.value) < 1e-6 && Math.abs(lastLng.value) < 1e-6);

    if (!hasValidCoords) {
      if (hasLastCoords) {
        la = lastLat.value;
        ln = lastLng.value;
      } else {
        if (lastShape.value !== EMPTY_SHAPE) {
          lastShape.value = EMPTY_SHAPE;
        }
        return { shape: EMPTY_SHAPE };
      }
    }

    la = Math.round(la / COORD_QUANT) * COORD_QUANT;
    ln = Math.round(ln / COORD_QUANT) * COORD_QUANT;

    const prevLa = lastLat.value;
    const prevLn = lastLng.value;
    if (
      Number.isFinite(prevLa)
      && Number.isFinite(prevLn)
      && Math.abs(la - prevLa) <= COORD_EPS
      && Math.abs(ln - prevLn) <= COORD_EPS
    ) {
      return { shape: lastShape.value };
    }

    lastLat.value = la;
    lastLng.value = ln;
    const nextShape = JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ln, la] },
        properties: { bearing: marker.heading.value },
      }],
    });
    lastShape.value = nextShape;
    return { shape: nextShape };
  });

  /**
   * Panel: model-rotation = [pitch, roll, bearing + rotationOffset]
   * RN Mapbox ModelLayer wymaga literału — aktualizacja co klatkę (jak strzałka).
   */
  useFrameCallback(() => {
    'worklet';
    let hdg = marker.heading.value;
    hdg = Number.isFinite(hdg) ? hdg : 0;
    const wrappedTarget = normalizeHeadingW(hdg + rotOffsetSv.value);
    const yaw = unwrapYawToward(lastUnwrappedYaw.value, wrappedTarget);
    lastUnwrappedYaw.value = yaw;

    const prevYaw = lastPushedYaw.value;
    if (Number.isFinite(prevYaw) && Math.abs(yaw - prevYaw) < YAW_PUSH_EPS) {
      return;
    }
    lastPushedYaw.value = yaw;
    runOnJS(pushLayerRotation)(yaw);
  }, true);

  if (!visible) return null;

  return (
    <ReanimatedShapeSource
      id="self-vehicle-model-src"
      animatedProps={animatedShapeProps}
    >
      <Mapbox.ModelLayer
        ref={layerRef as React.RefObject<never>}
        key={`self-vehicle-model-${metaKey}`}
        id="self-vehicle-model-layer"
        minZoomLevel={5}
        style={{
          modelId: SELF_VEHICLE_MODEL_KEY,
          modelType: 'common-3d',
          modelElevationReference: 'ground',
          modelOpacity: 1,
          modelCastShadows: false,
          modelReceiveShadows: false,
          modelAllowDensityReduction: true,
          modelRotation: layerStyle.modelRotation,
          modelScale: layerStyle.modelScale,
          modelTranslation: layerStyle.modelTranslation,
        }}
      />
    </ReanimatedShapeSource>
  );
}

export const SelfVehicleModelLayer = memo(SelfVehicleModelLayerInner);
