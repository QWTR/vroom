import React, { memo, useEffect, useState, type ReactNode } from 'react';
import { DeviceEventEmitter, Text, View } from 'react-native';

export const SPEEDOMETER_EVENT = 'vroom:speedometer:update';

/** Twardy sufit HUD — realna jazda max ~200; 250 tylko jako clamp resztek błędu. */
const HUD_SPEED_CAP_KMH = 200;

/** Zawsze zwraca skończoną prędkość ≥ 0 — 0 km/h to poprawna wartość, nie brak sygnału. */
export function normalizeHudSpeedKmh(value: unknown): number {
  if (value == null || typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  const raw = Math.max(0, value);
  return raw > HUD_SPEED_CAP_KMH ? HUD_SPEED_CAP_KMH : raw;
}

/**
 * Preferuj jawny prop (w tym 0), potem strumień live — nigdy `||`, bo 0 jest falsy.
 */
export function resolveHudSpeedKmh(
  explicitKmh: number | null | undefined,
  liveKmh: number,
): number {
  if (explicitKmh != null && Number.isFinite(explicitKmh)) {
    return normalizeHudSpeedKmh(explicitKmh);
  }
  return normalizeHudSpeedKmh(liveKmh);
}

export function emitSpeedometerKmh(kmh: number | null | undefined) {
  DeviceEventEmitter.emit(SPEEDOMETER_EVENT, {
    kmh: normalizeHudSpeedKmh(kmh),
  });
}

function useSpeedometerKmh(initialKmh = 0) {
  const safeInitial = normalizeHudSpeedKmh(initialKmh);
  const [kmh, setKmh] = useState(safeInitial);

  useEffect(() => {
    setKmh(safeInitial);
  }, [safeInitial]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      SPEEDOMETER_EVENT,
      (payload: { kmh?: number } | undefined) => {
        setKmh(normalizeHudSpeedKmh(payload?.kmh));
      },
    );
    return () => sub.remove();
  }, []);

  return kmh;
}

export const SpeedometerHUD = memo(function SpeedometerHUD({
  initialKmh = 0,
  children,
}: {
  initialKmh?: number;
  children: (kmh: number) => ReactNode;
}) {
  const kmh = useSpeedometerKmh(initialKmh);
  return <>{children(kmh)}</>;
});

export const SpeedValueText = memo(function SpeedValueText({
  initialKmh = 0,
  kmh,
  speedLimit,
  tolerance,
  style,
  unitStyle,
  showUnit = false,
}: {
  initialKmh?: number;
  kmh?: number;
  speedLimit: number | null;
  tolerance: number;
  style: any;
  unitStyle?: any;
  showUnit?: boolean;
}) {
  const liveKmh = useSpeedometerKmh(initialKmh);
  const valueKmh = resolveHudSpeedKmh(kmh, liveKmh);
  const overLimit = speedLimit !== null && valueKmh > speedLimit + tolerance;
  return (
    <Text style={[style, overLimit && { color: '#e33835' }]}>
      {Math.round(valueKmh)}
      {showUnit ? <Text style={unitStyle}> km/h</Text> : null}
    </Text>
  );
});

export const SpeedLimitBadge = memo(function SpeedLimitBadge({
  initialKmh = 0,
  kmh,
  speedLimit,
  tolerance,
  size = 44,
  smallFontAt = 100,
  style,
}: {
  initialKmh?: number;
  kmh?: number;
  speedLimit: number | null;
  tolerance: number;
  size?: number;
  smallFontAt?: number;
  style?: any;
}) {
  const liveKmh = useSpeedometerKmh(initialKmh);
  const valueKmh = resolveHudSpeedKmh(kmh, liveKmh);
  const overLimit = speedLimit !== null && valueKmh > speedLimit + tolerance;
  const smallFont = speedLimit != null && speedLimit >= smallFontAt;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#fff',
          borderWidth: size >= 48 ? 3 : 4,
          borderColor: overLimit ? '#e33835' : '#222',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text
        style={{
          fontFamily: 'Orbitron',
          fontSize: smallFont ? 10 : 13,
          fontWeight: '900',
          color: overLimit ? '#e33835' : '#111',
        }}
      >
        {speedLimit ?? '—'}
      </Text>
    </View>
  );
});
