import type { VehicleModelMeta } from '../constants/shopCosmetics';
import { resolveMapVehicleScale } from './mapVehicleScale';

export const VEHICLE_MODEL_RENDERER_VERSION = 3 as const;

const MAX_PIVOT_XY_M = 50;
const MIN_ELEVATION_Z = -5;
const MAX_ELEVATION_Z = 10;
const MIN_MODEL_ZOOM = 0;
const MAX_MODEL_ZOOM = 22;

export const DEFAULT_VEHICLE_MODEL_META: VehicleModelMeta = {
  rendererVersion: VEHICLE_MODEL_RENDERER_VERSION,
  scale: [1, 1, 1],
  yawOffset: 0,
  pitch: 0,
  roll: 0,
  pivotX: 0,
  pivotY: 0,
  elevationZ: 0.8,
  minZoom: 10,
};

export type VehicleModelLayerStyle = {
  modelRotation: [number, number, number];
  modelScale: [number, number, number];
  modelTranslation: [number, number, number];
};

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

function finiteNumber(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function clampPivotXY(n: number): number {
  return clamp(Number(n) || 0, -MAX_PIVOT_XY_M, MAX_PIVOT_XY_M);
}

function parseTriple(raw: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(raw) || raw.length < 3) return [...fallback] as [number, number, number];
  return [
    finiteNumber(raw[0], fallback[0]),
    finiteNumber(raw[1], fallback[1]),
    finiteNumber(raw[2], fallback[2]),
  ];
}

function resolveScaleAxis(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function parseScale(raw: unknown, o?: Record<string, unknown>): [number, number, number] {
  if (Array.isArray(raw) && raw.length >= 3) {
    const scale = parseTriple(raw, DEFAULT_VEHICLE_MODEL_META.scale);
    return [
      resolveScaleAxis(scale[0]),
      resolveScaleAxis(scale[1]),
      resolveScaleAxis(scale[2]),
    ];
  }
  if (o) {
    const sx = o.scaleX ?? o.scale_x;
    const sy = o.scaleY ?? o.scale_y;
    const sz = o.scaleZ ?? o.scale_z;
    if (sx != null || sy != null || sz != null) {
      return [
        resolveScaleAxis(sx),
        resolveScaleAxis(sy),
        resolveScaleAxis(sz),
      ];
    }
  }
  return [...DEFAULT_VEHICLE_MODEL_META.scale] as [number, number, number];
}

function parseMinZoom(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_VEHICLE_MODEL_META.minZoom;
  return clamp(n, MIN_MODEL_ZOOM, MAX_MODEL_ZOOM);
}

/**
 * Panel kalibracyjny zapisuje już yaw w konwencji natywnego ModelLayer.
 * Dodatkowe +90° ustawiało poprawnie skalibrowane samochody bokiem w aplikacji.
 */
export const RN_MAPBOX_MODEL_YAW_FLIP_DEG = 0;

/**
 * Yaw offset dla markera 3D na telefonie. IDEMPOTENTNE (normalize wołane jest wielokrotnie
 * w pipeline: kontrakt equipped + marker — nie wolno dwa razy dodać korekty).
 * - jeśli wejście ma JUŻ mobileYawOffset (sentinel z poprzedniego normalize lub ręczne
 *   nadpisanie admina) → użyj go DOSŁOWNIE, bez kolejnego flipa,
 * - w przeciwnym razie (surowe dane web): webYawOffset + korekta GL JS → mobile.
 */
function resolveMobileYawOffset(o: Record<string, unknown>): number {
  const rawMobile = o.mobileYawOffset;
  if (rawMobile != null && String(rawMobile).trim() !== '' && Number.isFinite(Number(rawMobile))) {
    return normalizeHeadingDeg(finiteNumber(rawMobile, 0));
  }
  const webYaw = finiteNumber(o.yawOffset ?? o.rotationOffset ?? o.rotation, 0);
  return normalizeHeadingDeg(webYaw + RN_MAPBOX_MODEL_YAW_FLIP_DEG);
}

/** Normalizuje metadata v3 — pivot w GLB, tylko elevationZ w translacji. */
export function normalizeVehicleModelMeta(raw: unknown): VehicleModelMeta {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VEHICLE_MODEL_META };
  const o = raw as Record<string, unknown>;
  const legacyTranslation = parseTriple(o.translation, [0, 0, DEFAULT_VEHICLE_MODEL_META.elevationZ ?? 0.8]);
  const elevationZ = clamp(
    finiteNumber(o.elevationZ, legacyTranslation[2]),
    MIN_ELEVATION_Z,
    MAX_ELEVATION_Z,
  );

  const resolvedYaw = resolveMobileYawOffset(o);

  return {
    rendererVersion: VEHICLE_MODEL_RENDERER_VERSION,
    scale: parseScale(o.scale, o),
    yawOffset: resolvedYaw,
    // Sentinel — kolejne normalize (kontrakt → marker) wezmą tę wartość bez ponownej korekty.
    mobileYawOffset: resolvedYaw,
    pitch: finiteNumber(o.pitch ?? o.rotationPitch, 0),
    roll: finiteNumber(o.roll ?? o.rotationRoll, 0),
    pivotX: 0,
    pivotY: 0,
    elevationZ,
    calibrationHeading: Number.isFinite(Number(o.calibrationHeading))
      ? Number(o.calibrationHeading)
      : undefined,
    minZoom: parseMinZoom(o.minZoom),
  };
}

/** Normalizacja azymutu 0–360 (JS + worklet). */
export function normalizeHeadingDeg(headingDeg: number): number {
  const h = Number.isFinite(headingDeg) ? headingDeg : 0;
  return ((h % 360) + 360) % 360;
}

export function normalizeHeadingDegWorklet(headingDeg: number): number {
  'worklet';
  const h = Number.isFinite(headingDeg) ? headingDeg : 0;
  return ((h % 360) + 360) % 360;
}

/** modelRot2 (Z) = travelHeading + yawOffset — identycznie jak panel admina. */
export function computeVehicleModelYaw(
  headingDeg: number,
  yawOffset: number,
): number {
  const h = normalizeHeadingDeg(headingDeg);
  const off = Number(yawOffset) || 0;
  return normalizeHeadingDeg(h + off);
}

export function computeVehicleModelYawWorklet(
  headingDeg: number,
  yawOffset: number,
): number {
  'worklet';
  const h = normalizeHeadingDegWorklet(headingDeg);
  const off = Number(yawOffset) || 0;
  return normalizeHeadingDegWorklet(h + off);
}

export function buildModelLayerTranslation(
  meta: Pick<VehicleModelMeta, 'elevationZ'>,
): [number, number, number] {
  return [
    0,
    0,
    clamp(finiteNumber(meta.elevationZ, 0.8), MIN_ELEVATION_Z, MAX_ELEVATION_Z),
  ];
}

export function buildModelLayerTranslationWorklet(
  elevationZRaw: number,
): [number, number, number] {
  'worklet';
  const elevationZ = Math.max(
    MIN_ELEVATION_Z,
    Math.min(MAX_ELEVATION_Z, Number.isFinite(Number(elevationZRaw)) ? Number(elevationZRaw) : 0.8),
  );
  return [0, 0, elevationZ];
}

/** Jedna funkcja stylu — panel, app, backend. */
export function buildVehicleModelStyle(
  meta: Partial<VehicleModelMeta> | null | undefined,
  travelHeadingDeg: number,
): VehicleModelLayerStyle {
  const norm = meta?.rendererVersion === VEHICLE_MODEL_RENDERER_VERSION && Array.isArray(meta.scale)
    ? (meta as VehicleModelMeta)
    : normalizeVehicleModelMeta(meta);
  const [sx, sy, sz] = resolveMapVehicleScale(norm.scale);
  const [tx, ty, tz] = buildModelLayerTranslation(norm);
  const pitch = finiteNumber(norm.pitch, 0);
  const roll = finiteNumber(norm.roll, 0);
  const yaw = computeVehicleModelYaw(travelHeadingDeg, finiteNumber(norm.yawOffset, 0));
  return {
    modelRotation: [pitch, roll, yaw],
    modelScale: [sx, sy, sz],
    modelTranslation: [tx, ty, tz],
  };
}

export function buildStaticModelRotation(
  meta: Pick<VehicleModelMeta, 'yawOffset' | 'pitch' | 'roll'>,
  headingDeg: number,
): [number, number, number] {
  const style = buildVehicleModelStyle(meta, headingDeg);
  return style.modelRotation;
}

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

export type SelfModelRotationExpression = readonly [
  'array', 'number', 3,
  number, number,
  readonly ['to-number', readonly ['get', 'modelYaw']],
];

/** Self marker: pitch/roll literały, yaw z GeoJSON (to-number dla RN Android). */
export function buildSelfVehicleModelLayerRotationExpression(
  pitch: number,
  roll: number,
): SelfModelRotationExpression {
  return [
    'array', 'number', 3,
    finiteNumber(pitch, 0),
    finiteNumber(roll, 0),
    ['to-number', ['get', 'modelYaw']],
  ];
}

export function buildFleetModelLayerTranslationExpression(): FleetModelTranslationExpression {
  return ['array', 'number', 3, ['get', 'transX'], ['get', 'transY'], ['get', 'transZ']];
}

export function buildModelLayerRotation(
  meta: Pick<VehicleModelMeta, 'pitch' | 'roll'>,
  yawProperty = 'modelYaw',
): ModelRotationExpression {
  const pitch = finiteNumber(meta.pitch, 0);
  const roll = finiteNumber(meta.roll, 0);
  return ['array', 'number', 3, pitch, roll, ['get', yawProperty]];
}

export function buildVehicleModelLayerStyle(
  modelId: string | readonly ['get', string],
) {
  return {
    modelId,
    modelType: 'common-3d' as const,
    modelElevationReference: 'ground' as const,
    modelOpacity: 1,
    modelOpacityTransition: { duration: 0, delay: 0 },
    modelCastShadows: false,
    modelReceiveShadows: false,
    modelAllowDensityReduction: true,
    modelRotation: buildFleetModelLayerRotationExpression(),
    modelScale: ['array', 'number', 3, ['get', 'scaleX'], ['get', 'scaleY'], ['get', 'scaleZ']] as const,
    modelTranslation: buildFleetModelLayerTranslationExpression(),
  };
}

/**
 * Własny marker 3D — scale/translation jako LITERAŁY (stałe na marker).
 * modelRotation NIE jest tu ustawiane: RN ModelLayer renderuje data-driven rotację INNĄ konwencją
 * (zły heading), więc komponent dokłada literal [pitch, roll, yaw] (poprawny heading jak panel).
 */
export function buildSelfVehicleModelLayerStyle(
  modelId: string,
  meta: Partial<VehicleModelMeta> | null | undefined,
) {
  const norm = normalizeVehicleModelMeta(meta);
  const staticStyle = buildVehicleModelStyle(norm, 0);
  return {
    modelId,
    modelType: 'common-3d' as const,
    modelElevationReference: 'ground' as const,
    modelOpacity: 1,
    modelOpacityTransition: { duration: 0, delay: 0 },
    modelCastShadows: false,
    modelReceiveShadows: false,
    modelAllowDensityReduction: true,
    modelEmissiveStrength: 1.25,
    modelRotationTransition: { duration: 0, delay: 0 },
    modelScaleTransition: { duration: 0, delay: 0 },
    modelTranslationTransition: { duration: 0, delay: 0 },
    modelScale: staticStyle.modelScale,
    modelTranslation: staticStyle.modelTranslation,
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
  minZoom: number;
};

export function buildVehicleModelFeatureProperties(
  meta: Partial<VehicleModelMeta>,
  headingDeg: number,
): VehicleModelShapeProps {
  const norm = normalizeVehicleModelMeta(meta);
  const style = buildVehicleModelStyle(norm, headingDeg);
  return {
    modelRot0: style.modelRotation[0],
    modelRot1: style.modelRotation[1],
    modelRot2: style.modelRotation[2],
    transX: style.modelTranslation[0],
    transY: style.modelTranslation[1],
    transZ: style.modelTranslation[2],
    scaleX: style.modelScale[0],
    scaleY: style.modelScale[1],
    scaleZ: style.modelScale[2],
    minZoom: norm.minZoom,
  };
}

export function buildModelLayerScale(
  scale: [number, number, number],
): [number, number, number] | ModelScaleExpression {
  return ['array', 'number', 3, ['get', 'scaleX'], ['get', 'scaleY'], ['get', 'scaleZ']];
}

export function serializeVehicleModelMeta(fields: {
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  yawOffset: number;
  pitch?: number;
  roll?: number;
  pivotX?: number;
  pivotY?: number;
  elevationZ?: number;
  minZoom?: number;
  calibrationHeading?: number;
}): VehicleModelMeta {
  return {
    rendererVersion: VEHICLE_MODEL_RENDERER_VERSION,
    scale: [
      Number(fields.scaleX) || 1,
      Number(fields.scaleY) || 1,
      Number(fields.scaleZ) || 1,
    ],
    yawOffset: Number(fields.yawOffset) || 0,
    pitch: Number(fields.pitch) || 0,
    roll: Number(fields.roll) || 0,
    pivotX: clampPivotXY(Number(fields.pivotX) || 0),
    pivotY: clampPivotXY(Number(fields.pivotY) || 0),
    elevationZ: Number.isFinite(Number(fields.elevationZ)) ? Number(fields.elevationZ) : 0.8,
    minZoom: Number(fields.minZoom) || 14,
    ...(Number.isFinite(Number(fields.calibrationHeading))
      ? { calibrationHeading: Number(fields.calibrationHeading) }
      : {}),
  };
}
