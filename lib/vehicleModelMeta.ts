import type { VehicleModelMeta } from '../constants/shopCosmetics';
import { resolveMapVehicleScale } from './mapVehicleScale';

export const DEFAULT_VEHICLE_MODEL_META: VehicleModelMeta = {
  scale: [1, 1, 1],
  rotationOffset: 0,
  rotationPitch: 0,
  rotationRoll: 0,
  translation: [0, 0, 0.8],
  minZoom: 10,
};

/** RN Mapbox wymaga pełnego wyrażenia — NIE [pitch, roll, ['get', …]]. */
export type ModelRotationExpression = readonly [
  'array', 'number', 3,
  number, number,
  readonly ['get', string] | readonly ['+', readonly ['get', string], number],
];

export type ModelScaleExpression = readonly [
  'array', 'number', 3,
  readonly ['get', string],
  readonly ['get', string],
  readonly ['get', string],
];

function parseTriple(raw: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(raw) || raw.length < 3) return fallback;
  return [
    Number(raw[0]) || 0,
    Number(raw[1]) || 0,
    Number.isFinite(Number(raw[2])) ? Number(raw[2]) : fallback[2],
  ];
}

/** Normalizuje metadata z API / inventory (panel admina). */
export function normalizeVehicleModelMeta(raw: unknown): VehicleModelMeta {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VEHICLE_MODEL_META };
  const o = raw as Record<string, unknown>;
  const scaleRaw = o.scale;
  const scale = Array.isArray(scaleRaw) && scaleRaw.length === 3
    ? [
        Number(scaleRaw[0]) || 1,
        Number(scaleRaw[1]) || 1,
        Number(scaleRaw[2]) || 1,
      ] as [number, number, number]
    : [...DEFAULT_VEHICLE_MODEL_META.scale] as [number, number, number];
  return {
    scale,
    rotationOffset: Number(o.rotationOffset ?? o.rotation) || 0,
    rotationPitch: Number(o.rotationPitch) || 0,
    rotationRoll: Number(o.rotationRoll) || 0,
    translation: parseTriple(o.translation, DEFAULT_VEHICLE_MODEL_META.translation!),
    minZoom: Number(o.minZoom) || DEFAULT_VEHICLE_MODEL_META.minZoom,
  };
}

/**
 * modelRotation dla @rnmapbox/maps — całe wyrażenie zaczyna się od "array".
 * yawProperty: pole w GeoJSON (np. modelYaw) z gotowym kątem w stopniach.
 */
export function buildModelLayerRotation(
  meta: Pick<VehicleModelMeta, 'rotationPitch' | 'rotationRoll'>,
  yawProperty = 'modelYaw',
): ModelRotationExpression {
  const pitch = Number(meta.rotationPitch) || 0;
  const roll = Number(meta.rotationRoll) || 0;
  return ['array', 'number', 3, pitch, roll, ['get', yawProperty]];
}

/**
 * Yaw modelu — identycznie jak panel admina (Mapbox GL):
 * model-rotation[2] = bearing + rotationOffset
 */
export function computeVehicleModelYaw(
  headingDeg: number,
  rotationOffset: number,
): number {
  const h = Number.isFinite(headingDeg) ? headingDeg : 0;
  const off = Number(rotationOffset) || 0;
  return ((h + off) % 360 + 360) % 360;
}

/** Statyczny obrót (tryb browse bez animacji). */
export function buildStaticModelRotation(
  meta: Pick<VehicleModelMeta, 'rotationOffset' | 'rotationPitch' | 'rotationRoll'>,
  headingDeg: number,
): [number, number, number] {
  const pitch = Number(meta.rotationPitch) || 0;
  const roll = Number(meta.rotationRoll) || 0;
  const yaw = computeVehicleModelYaw(headingDeg, Number(meta.rotationOffset) || 0);
  return [pitch, roll, yaw];
}

/**
 * RN Mapbox: modelRotation z mieszanką literałów i ['get', …] pada.
 * Flota: wszystkie 3 składowe z właściwości GeoJSON.
 */
export type FleetModelRotationExpression = readonly [
  'array', 'number', 3,
  readonly ['get', 'modelRot0'],
  readonly ['get', 'modelRot1'],
  readonly ['get', 'modelRot2'],
];

export type FleetModelTranslationExpression = readonly [
  'array', 'number', 3,
  readonly ['get', 'transX'],
  readonly ['get', 'transY'],
  readonly ['get', 'transZ'],
];

export function buildFleetModelLayerRotationExpression(): FleetModelRotationExpression {
  return ['array', 'number', 3, ['get', 'modelRot0'], ['get', 'modelRot1'], ['get', 'modelRot2']];
}

export function buildFleetModelLayerTranslationExpression(): FleetModelTranslationExpression {
  return ['array', 'number', 3, ['get', 'transX'], ['get', 'transY'], ['get', 'transZ']];
}

/** Jak w panelu admina (VehicleModelMapEditor). */
const MAX_TRANSLATION_XY_M = 50;

export function buildModelLayerTranslation(
  meta: Pick<VehicleModelMeta, 'translation'>,
): [number, number, number] {
  const t = meta.translation;
  if (!t) return [0, 0, 0.8];
  const clampXY = (n: number) => Math.max(-MAX_TRANSLATION_XY_M, Math.min(MAX_TRANSLATION_XY_M, n));
  return [
    clampXY(Number(t[0]) || 0),
    clampXY(Number(t[1]) || 0),
    Number.isFinite(Number(t[2])) ? Number(t[2]) : 0.8,
  ];
}

/** Wspólny styl ModelLayer — rotacja/skala/translacja z GeoJSON (działa na RN). */
export function buildVehicleModelLayerStyle(
  modelId: string | readonly ['get', string],
) {
  return {
    modelId,
    modelType: 'common-3d' as const,
    modelElevationReference: 'ground' as const,
    modelOpacity: 1,
    modelCastShadows: false,
    modelReceiveShadows: false,
    modelAllowDensityReduction: true,
    modelRotation: buildFleetModelLayerRotationExpression(),
    modelScale: ['array', 'number', 3, ['get', 'scaleX'], ['get', 'scaleY'], ['get', 'scaleZ']] as const,
    modelTranslation: buildFleetModelLayerTranslationExpression(),
  };
}

export type VehicleModelShapeProps = {
  modelRot0: number;
  modelRot1: number;
  modelRot2: number;
  transX: number;
  transY: number;
  transZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
};

export function buildVehicleModelFeatureProperties(
  meta: Pick<VehicleModelMeta, 'rotationOffset' | 'rotationPitch' | 'rotationRoll' | 'translation' | 'scale'>,
  headingDeg: number,
): VehicleModelShapeProps {
  const norm = normalizeVehicleModelMeta(meta);
  const [sx, sy, sz] = resolveMapVehicleScale(norm.scale);
  const [tx, ty, tz] = buildModelLayerTranslation(norm);
  const pitch = Number(norm.rotationPitch) || 0;
  const roll = Number(norm.rotationRoll) || 0;
  const offset = Number(norm.rotationOffset) || 0;
  const yaw = computeVehicleModelYaw(headingDeg, offset);
  return {
    modelRot0: pitch,
    modelRot1: roll,
    modelRot2: yaw,
    transX: tx,
    transY: ty,
    transZ: tz,
    scaleX: sx,
    scaleY: sy,
    scaleZ: sz,
  };
}

export function buildModelLayerScale(
  scale: [number, number, number],
): [number, number, number] | ModelScaleExpression {
  return ['array', 'number', 3, ['get', 'scaleX'], ['get', 'scaleY'], ['get', 'scaleZ']];
}

/** Metadata zapis do API (panel admina / backend). */
export function serializeVehicleModelMeta(fields: {
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotationOffset: number;
  rotationPitch?: number;
  rotationRoll?: number;
  translationX?: number;
  translationY?: number;
  translationZ?: number;
  minZoom?: number;
}): VehicleModelMeta {
  return {
    scale: [
      Number(fields.scaleX) || 1,
      Number(fields.scaleY) || 1,
      Number(fields.scaleZ) || 1,
    ],
    rotationOffset: Number(fields.rotationOffset) || 0,
    rotationPitch: Number(fields.rotationPitch) || 0,
    rotationRoll: Number(fields.rotationRoll) || 0,
    translation: [
      Number(fields.translationX) || 0,
      Number(fields.translationY) || 0,
      Number.isFinite(Number(fields.translationZ)) ? Number(fields.translationZ) : 0.8,
    ],
    minZoom: Number(fields.minZoom) || 14,
  };
}
